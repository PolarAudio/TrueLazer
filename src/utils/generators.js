import opentype from 'opentype.js';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

const fontCache = new WeakMap();

export async function generateText(params, fontBuffer) {
  try {
    if (!fontBuffer) {
      throw new Error('A font buffer is required to generate text.');
    }
    const { text, x, y, r, g, b, fontSize, numPoints } = withDefaults(params, {
      text: 'TrueLazer',
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255,
      fontSize: 72,
      numPoints: 200
    });

    let font = fontCache.get(fontBuffer);
    if (!font) {
        font = opentype.parse(fontBuffer);
        fontCache.set(fontBuffer, font);
    }
    const path = font.getPath(text, 0, 0, fontSize);
    const commands = path.commands;

    // Calculate bounding box to center the text
    const bbox = path.getBoundingBox();
    const midX = (bbox.x1 + bbox.x2) / 2;
    const midY = (bbox.y1 + bbox.y2) / 2;
    
    // First, calculate total "rough" length to distribute numPoints
    let totalLength = 0;
    let prevX = 0, prevY = 0;
    commands.forEach(cmd => {
        if (cmd.type === 'M') {
            prevX = cmd.x; prevY = cmd.y;
        } else if (cmd.type === 'L' || cmd.type === 'Q' || cmd.type === 'C') {
            const dx = cmd.x - prevX;
            const dy = cmd.y - prevY;
            totalLength += Math.sqrt(dx * dx + dy * dy);
            prevX = cmd.x; prevY = cmd.y;
        }
    });

    const pointsPerUnit = numPoints / (totalLength || 1);
    const sampledPoints = [];
    prevX = 0; prevY = 0;
    let startX = 0, startY = 0;

    // We use a constant divisor (e.g., 200) to normalize the opentype coordinates 
    // to the [-1, 1] laser range. Since fontSize is already used in font.getPath,
    // this constant ensures the slider works as expected.
    const normalizeScale = 200;

    commands.forEach(cmd => {
        if (cmd.type === 'M') {
            // Add a blanked point at the previous position to turn off the laser
            if (sampledPoints.length > 0) {
                const last = sampledPoints[sampledPoints.length - 1];
                sampledPoints.push({
                    ...last,
                    r: 0, g: 0, b: 0,
                    blanking: true
                });
            }

            startX = cmd.x; startY = cmd.y;
            // Add a blanked point at the NEW position to allow the scanner to settle
            const targetX = (cmd.x - midX) / normalizeScale + x;
            const targetY = -(cmd.y - midY) / normalizeScale + y;
            
            sampledPoints.push({ 
                x: targetX, 
                y: targetY, 
                r: 0, g: 0, b: 0, 
                blanking: true 
            });
            
            // Add a COLORED point at the same position to start the path
            sampledPoints.push({ 
                x: targetX, 
                y: targetY, 
                r, g, b, 
                blanking: false 
            });
            
            prevX = cmd.x; prevY = cmd.y;
        } else if (cmd.type === 'L') {
            const dx = cmd.x - prevX;
            const dy = cmd.y - prevY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(1, Math.floor(dist * pointsPerUnit));
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                sampledPoints.push({ 
                    x: (prevX + dx * t - midX) / normalizeScale + x, 
                    y: -(prevY + dy * t - midY) / normalizeScale + y, 
                    r, g, b 
                });
            }
            prevX = cmd.x; prevY = cmd.y;
        } else if (cmd.type === 'Q') {
            const dx = cmd.x - prevX;
            const dy = cmd.y - prevY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(2, Math.floor(dist * pointsPerUnit));
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                // Quadratic Bezier: (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2
                const cx = Math.pow(1-t, 2) * prevX + 2 * (1-t) * t * cmd.x1 + Math.pow(t, 2) * cmd.x;
                const cy = Math.pow(1-t, 2) * prevY + 2 * (1-t) * t * cmd.y1 + Math.pow(t, 2) * cmd.y;
                sampledPoints.push({ x: (cx - midX) / normalizeScale + x, y: -(cy - midY) / normalizeScale + y, r, g, b });
            }
            prevX = cmd.x; prevY = cmd.y;
        } else if (cmd.type === 'C') {
            const dx = cmd.x - prevX;
            const dy = cmd.y - prevY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(3, Math.floor(dist * pointsPerUnit));
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                // Cubic Bezier: (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)t^2*P2 + t^3*P3
                const cx = Math.pow(1-t, 3) * prevX + 3 * Math.pow(1-t, 2) * t * cmd.x1 + 3 * (1-t) * Math.pow(t, 2) * cmd.x2 + Math.pow(t, 3) * cmd.x;
                const cy = Math.pow(1-t, 3) * prevY + 3 * Math.pow(1-t, 2) * t * cmd.y1 + 3 * (1-t) * Math.pow(t, 2) * cmd.y2 + Math.pow(t, 3) * cmd.y;
                sampledPoints.push({ x: (cx - midX) / normalizeScale + x, y: -(cy - midY) / normalizeScale + y, r, g, b });
            }
            prevX = cmd.x; prevY = cmd.y;
        } else if (cmd.type === 'Z') {
            // Close path: return to startX, startY
            sampledPoints.push({ 
                x: (startX - midX) / normalizeScale + x, 
                y: -(startY - midY) / normalizeScale + y, 
                r, g, b 
            });
            prevX = startX; prevY = startY;
        }
    });

    // Add a final blanked point at the last position to ensure clean blanking after the text
    if (sampledPoints.length > 0) {
        const lastPoint = sampledPoints[sampledPoints.length - 1];
        sampledPoints.push({
            ...lastPoint,
            r: 0, g: 0, b: 0,
            blanking: true
        });
    }

    return { points: sampledPoints };
  } catch (error) {
    console.error('Error in generateText:', error);
    throw error;
  }
}

export function generateCircle(params) {
  try {
    const { radius, numPoints, x, y, r, g, b } = withDefaults(params, {
      radius: 0.5,
      numPoints: 100,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255
    });

    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      points.push({
        x: radius * Math.cos(angle) + x,
        y: radius * Math.sin(angle) + y,
        r, g, b
      });
    }
    
    // Add final blanked point
    if (points.length > 0) {
        const last = points[points.length - 1];
        points.push({ ...last, r: 0, g: 0, b: 0, blanking: true });
    }

    return { points };
  } catch (error) {
    console.error('Error in generateCircle:', error);
    throw error;
  }
}

export function generateSquare(params) {
  try {
    const { width, height, pointDensity, x, y, r, g, b } = withDefaults(params, {
      width: 1,
      height: 1,
      pointDensity: 25,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255
    });

    const corners = [
      { x: -width / 2 + x, y: -height / 2 + y },
      { x: width / 2 + x, y: -height / 2 + y },
      { x: width / 2 + x, y: height / 2 + y },
      { x: -width / 2 + x, y: height / 2 + y },
      { x: -width / 2 + x, y: -height / 2 + y },
    ];

    const points = [];
    for (let i = 0; i < corners.length - 1; i++) {
      const start = corners[i];
      const end = corners[i + 1];
      for (let j = 0; j < pointDensity; j++) {
        const t = j / pointDensity;
        points.push({
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
          r, g, b
        });
      }
    }
    // Add the final corner to close the loop
    points.push({ ...corners[corners.length - 1], r, g, b });

    // Add final blanked point
    if (points.length > 0) {
        const last = points[points.length - 1];
        points.push({ ...last, r: 0, g: 0, b: 0, blanking: true });
    }

    return { points };
  } catch (error) {
    console.error('Error in generateSquare:', error);
    throw error;
  }
}

export function generateLine(params) {
  try {
    const { x1, y1, x2, y2, pointDensity, r, g, b } = withDefaults(params, {
      x1: -0.5,
      y1: 0,
      x2: 0.5,
      y2: 0,
      pointDensity: 50,
      r: 255,
      g: 255,
      b: 255
    });

    const points = [];
    for (let i = 0; i <= pointDensity; i++) {
      const t = i / pointDensity;
      points.push({
        x: x1 + (x2 - x1) * t,
        y: y1 + (y2 - y1) * t,
        r, g, b
      });
    }

    // Add final blanked point
    if (points.length > 0) {
        const last = points[points.length - 1];
        points.push({ ...last, r: 0, g: 0, b: 0, blanking: true });
    }

    return { points };
  } catch (error) {
    console.error('Error in generateLine:', error);
    throw error;
  }
}

export function generateStar(params) {
  try {
    const { outerRadius, innerRadius, numSpikes, pointDensity, x, y, r, g, b } = withDefaults(params, {
      outerRadius: 0.5,
      innerRadius: 0.2,
      numSpikes: 5,
      pointDensity: 10,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255
    });

    const vertices = [];
    for (let i = 0; i < numSpikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (numSpikes * 2)) * 2 * Math.PI - Math.PI / 2;
      vertices.push({
        x: radius * Math.cos(angle) + x,
        y: radius * Math.sin(angle) + y
      });
    }
    vertices.push({ ...vertices[0] });

    const points = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      const start = vertices[i];
      const end = vertices[i + 1];
      for (let j = 0; j < pointDensity; j++) {
        const t = j / pointDensity;
        points.push({
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
          r, g, b
        });
      }
    }
    points.push({ ...vertices[vertices.length - 1], r, g, b });

    // Add final blanked point
    if (points.length > 0) {
        const last = points[points.length - 1];
        points.push({ ...last, r: 0, g: 0, b: 0, blanking: true });
    }

    return { points };
  } catch (error) {
    console.error('Error in generateStar:', error);
    throw error;
  }
}

export async function generateNdiSource(params, fontBuffer, ndiFrame = null) {
    try {
        const { sourceName, threshold, edgeDetection, x, y, scale, r, g, b } = withDefaults(params, {
            sourceName: 'NDI Input',
            threshold: 128,
            edgeDetection: false,
            x: 0,
            y: 0,
            scale: 1.0,
            r: 255,
            g: 255,
            b: 255
        });
        
        if (!ndiFrame || !ndiFrame.data) {
            return { points: [{ x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true }] };
        }

        const { width: srcW, height: srcH, data: srcData } = ndiFrame;
        
        // 1. Working Buffer Strategy
        // Increased processing resolution for better workstations
        const workingWidth = Math.min(srcW, 640);
        const workingScale = workingWidth / srcW;
        const w = workingWidth;
        const h = Math.floor(srcH * workingScale);
        
        const workingGray = new Uint8Array(w * h);
        const blurred = new Uint8Array(w * h);

        // Fast Downsample + Grayscale
        for (let py = 0; py < h; py++) {
            const srcY = Math.floor(py / workingScale);
            const pyW = py * w;
            const srcYW = srcY * srcW;
            for (let px = 0; px < w; px++) {
                const srcX = Math.floor(px / workingScale);
                const srcIdx = (srcYW + srcX) * 4;
                workingGray[pyW + px] = (srcData[srcIdx] * 0.114 + srcData[srcIdx + 1] * 0.587 + srcData[srcIdx + 2] * 0.299);
            }
        }

        // Fast 3x3 Box Blur
        for (let py = 1; py < h - 1; py++) {
            const pyW = py * w;
            for (let px = 1; px < w - 1; px++) {
                const idx = pyW + px;
                blurred[idx] = (
                    workingGray[idx - w - 1] + workingGray[idx - w] + workingGray[idx - w + 1] +
                    workingGray[idx - 1]     + workingGray[idx]     + workingGray[idx + 1]     +
                    workingGray[idx + w - 1] + workingGray[idx + w] + workingGray[idx + w + 1]
                ) / 9;
            }
        }

        const candidatePoints = [];
        const skip = edgeDetection ? 1 : 2;

        if (edgeDetection) {
            // 2. High-Detail Sobel on Working Buffer
            for (let py = 1; py < h - 1; py += skip) {
                const pyW = py * w;
                for (let px = 1; px < w - 1; px += skip) {
                    const idx = pyW + px;
                    
                    const gx = (blurred[idx - w + 1] + 2 * blurred[idx + 1] + blurred[idx + w + 1]) - 
                               (blurred[idx - w - 1] + 2 * blurred[idx - 1] + blurred[idx + w - 1]);
                    const gy = (blurred[idx - w - 1] + 2 * blurred[idx - w] + blurred[idx - w + 1]) - 
                               (blurred[idx + w - 1] + 2 * blurred[idx + w] + blurred[idx + w + 1]);
                    
                    const magnitude = Math.sqrt(gx * gx + gy * gy) / 4;

                    if (magnitude > threshold) {
                        const lx = (px / w * 2 - 1) * scale + x;
                        const ly = (1 - py / h * 2) * scale + y;
                        
                        const srcX = Math.floor(px / workingScale);
                        const srcY = Math.floor(py / workingScale);
                        const dIdx = (srcY * srcW + srcX) * 4;

                        candidatePoints.push({
                            x: lx, y: ly,
                            px: px, py: py,
                            r: Math.round(srcData[dIdx + 2] * (r / 255)),
                            g: Math.round(srcData[dIdx + 1] * (g / 255)),
                            b: Math.round(srcData[dIdx] * (b / 255)),
                            blanking: false
                        });
                    }
                }
            }
        } else {
            // Basic Threshold Mode
            for (let py = 0; py < h; py += 2) {
                const pyW = py * w;
                for (let px = 0; px < w; px += 2) {
                    const idx = pyW + px;
                    if (workingGray[idx] > threshold) {
                        const lx = (px / w * 2 - 1) * scale + x;
                        const ly = (1 - py / h * 2) * scale + y;
                        const srcX = Math.floor(px / workingScale);
                        const srcY = Math.floor(py / workingScale);
                        const dIdx = (srcY * srcW + srcX) * 4;
                        candidatePoints.push({
                            x: lx, y: ly,
                            px: px, py: py,
                            r: Math.round(srcData[dIdx + 2] * (r / 255)),
                            g: Math.round(srcData[dIdx + 1] * (g / 255)),
                            b: Math.round(srcData[dIdx] * (b / 255)),
                            blanking: false
                        });
                    }
                }
            }
        }

        if (candidatePoints.length === 0) {
            return { points: [{ x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true }] };
        }

        // 3. Path Optimization (Greedy Nearest Neighbor in working pixel space)
        const optimizedPoints = [];
        const maxPoints = 4000;
        const actualPoints = candidatePoints.length > maxPoints ? candidatePoints.filter((_, i) => i % Math.ceil(candidatePoints.length / maxPoints) === 0) : candidatePoints;
        
        let currentP = actualPoints.splice(0, 1)[0];
        optimizedPoints.push(currentP);

        while (actualPoints.length > 0) {
            let closestIdx = -1;
            let minDistSq = Infinity;
            const searchLimit = actualPoints.length > 1000 ? 500 : actualPoints.length;

            for (let i = 0; i < searchLimit; i++) {
                const dpx = actualPoints[i].px - currentP.px;
                const dpy = actualPoints[i].py - currentP.py;
                const distSq = dpx * dpx + dpy * dpy;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closestIdx = i;
                }
                if (distSq <= 2) break;
            }

            const nextP = actualPoints.splice(closestIdx, 1)[0];
            const jumpThreshold = w * 0.15;
            if (minDistSq > (jumpThreshold * jumpThreshold)) {
                optimizedPoints.push({ ...currentP, r: 0, g: 0, b: 0, blanking: true });
                optimizedPoints.push({ ...nextP, r: 0, g: 0, b: 0, blanking: true });
            }

            optimizedPoints.push(nextP);
            currentP = nextP;
        }

        if (optimizedPoints.length > 0) {
            const last = optimizedPoints[optimizedPoints.length - 1];
            optimizedPoints.push({ ...last, r: 0, g: 0, b: 0, blanking: true });
        }

        return { points: optimizedPoints };
    } catch (error) {
        console.error('Error in generateNdiSource:', error);
        throw error;
    }
}

export async function generateSpoutReceiver(params, fontBuffer) {
    try {
        const { sourceName, x, y, r, g, b, scale } = withDefaults(params, {
            sourceName: 'Spout Input',
            x: 0,
            y: 0,
            r: 255,
            g: 255,
            b: 255,
            scale: 1.0
        });
        
        const textParams = {
            text: sourceName || 'Spout Input',
            x, y, r, g, b,
            fontSize: 72 * scale,
            numPoints: 200
        };
        
        return await generateText(textParams, fontBuffer);
    } catch (error) {
        console.error('Error in generateSpoutReceiver:', error);
        throw error;
    }
}
