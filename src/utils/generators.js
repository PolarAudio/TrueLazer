import opentype from 'opentype.js';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

// Persistent font cache using a simple object or Map
const parsedFontCache = new Map();

function applyRenderingStyle(points, params) {
    const { renderingStyle, thickness, blankingSize } = withDefaults(params, {
        renderingStyle: 'normal',
        thickness: 1,
        blankingSize: 3
    });

    if (renderingStyle === 'normal' || !points || points.length === 0) {
        return points;
    }

    const styledPoints = [];

    if (renderingStyle === 'dotted') {
        for (const p of points) {
            // Repeat the same point multiple times to increase dwell time (thicken the beam)
            for (let i = 0; i < thickness; i++) {
                styledPoints.push({ ...p });
            }
        }
    } else if (renderingStyle === 'blanked') {
        // "Blank each 2nd line" with adjustable segment size
        const size = Math.max(1, Math.floor(blankingSize));
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.blanking) {
                styledPoints.push({ ...p });
            } else {
                // Blocks of 'size' points on, 'size' points off
                if (Math.floor(i / size) % 2 === 0) {
                    styledPoints.push({ ...p });
                } else {
                    styledPoints.push({ ...p, r: 0, g: 0, b: 0, blanking: true });
                }
            }
        }
    } else if (renderingStyle === 'dots') {
        // "Only show the points and no lines"
        for (const p of points) {
            // 1. Move to point while blanked
            styledPoints.push({ ...p, r: 0, g: 0, b: 0, blanking: true });
            // 2. Show the point (Flash it)
            styledPoints.push({ ...p, blanking: false });
            // 3. Repeat to ensure visibility
            styledPoints.push({ ...p, blanking: false });
        }
    }

    return styledPoints;
}

export async function generateText(params, fontBuffer) {
  try {
    if (!fontBuffer) {
      throw new Error('A font buffer is required to generate text.');
    }
    
    const fontKey = `${fontBuffer.byteLength}_${new Uint8Array(fontBuffer.slice(0, 100)).join('')}`;
    
    let font = parsedFontCache.get(fontKey);
    if (!font) {
        font = opentype.parse(fontBuffer);
        parsedFontCache.set(fontKey, font);
        if (parsedFontCache.size > 10) {
            const firstKey = parsedFontCache.keys().next().value;
            parsedFontCache.delete(firstKey);
        }
    }
    const { text, x, y, r, g, b, fontSize, numPoints } = withDefaults(params, {
      text: 'TrueLazer',
      x: 0,
      y: 0.3,
      r: 255,
      g: 255,
      b: 255,
      fontSize: 72,
      numPoints: 100
    });

    const path = font.getPath(text, 0, 0, fontSize);
    const commands = path.commands;
    const bbox = path.getBoundingBox();
    const midX = (bbox.x1 + bbox.x2) / 2;
    const midY = (bbox.y1 + bbox.y2) / 2;
    
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
    const normalizeScale = 200;

    commands.forEach(cmd => {
        if (cmd.type === 'M') {
            if (sampledPoints.length > 0) {
                const last = sampledPoints[sampledPoints.length - 1];
                sampledPoints.push({ ...last, r: 0, g: 0, b: 0, blanking: true });
            }
            startX = cmd.x; startY = cmd.y;
            const targetX = (cmd.x - midX) / normalizeScale + x;
            const targetY = -(cmd.y - midY) / normalizeScale + y;
            sampledPoints.push({ x: targetX, y: targetY, r: 0, g: 0, b: 0, blanking: true });
            sampledPoints.push({ x: targetX, y: targetY, r, g, b, blanking: false });
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
                const cx = Math.pow(1-t, 3) * prevX + 3 * Math.pow(1-t, 2) * t * cmd.x1 + 3 * (1-t) * Math.pow(t, 2) * cmd.x2 + Math.pow(t, 3) * cmd.x;
                const cy = Math.pow(1-t, 3) * prevY + 3 * Math.pow(1-t, 2) * t * cmd.y1 + 3 * (1-t) * Math.pow(t, 2) * cmd.y2 + Math.pow(t, 3) * cmd.y;
                sampledPoints.push({ x: (cx - midX) / normalizeScale + x, y: -(cy - midY) / normalizeScale + y, r, g, b });
            }
            prevX = cmd.x; prevY = cmd.y;
        } else if (cmd.type === 'Z') {
            sampledPoints.push({ x: (startX - midX) / normalizeScale + x, y: -(startY - midY) / normalizeScale + y, r, g, b });
            prevX = startX; prevY = startY;
        }
    });

    if (sampledPoints.length > 0) {
        const lastPoint = sampledPoints[sampledPoints.length - 1];
        sampledPoints.push({ ...lastPoint, r: 0, g: 0, b: 0, blanking: true });
    }

    return { points: applyRenderingStyle(sampledPoints, params) };
  } catch (error) {
    console.error('Error in generateText:', error);
    throw error;
  }
}

export function generateCircle(params) {
  try {
    const { radius, numPoints, x, y, r, g, b } = withDefaults(params, {
      radius: 0.5,
      numPoints: 50,
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

    return { points: applyRenderingStyle(points, params) };
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
      pointDensity: 12,
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
    points.push({ ...corners[corners.length - 1], r, g, b });

    return { points: applyRenderingStyle(points, params) };
  } catch (error) {
    console.error('Error in generateSquare:', error);
    throw error;
  }
}

export function generateTriangle(params) {
  try {
    const { size, width, height, pointDensity, x, y, r, g, b } = withDefaults(params, {
      size: null,
      width: 1,
      height: 1,
      pointDensity: 12,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255
    });

    const w = size !== null ? size : width;
    const h = size !== null ? size : height;

    const corners = [
      { x: -w / 2 + x, y: -h / 2 + y }, // Bottom-left
      { x: w / 2 + x, y: -h / 2 + y },  // Bottom-right
      { x: x, y: h / 2 + y },           // Top-center
      { x: -w / 2 + x, y: -h / 2 + y }, // Back to start
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
    points.push({ ...corners[corners.length - 1], r, g, b });

    return { points: applyRenderingStyle(points, params) };
  } catch (error) {
    console.error('Error in generateTriangle:', error);
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

    return { points: applyRenderingStyle(points, params) };
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
      pointDensity: 5,
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

    return { points: applyRenderingStyle(points, params) };
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
        const workingWidth = Math.min(srcW, 640);
        const workingScale = workingWidth / srcW;
        const w = workingWidth;
        const h = Math.floor(srcH * workingScale);
        const workingGray = new Uint8Array(w * h);
        const blurred = new Uint8Array(w * h);

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

        const optimizedPoints = [];
        const maxPoints = 2000;
        let actualPoints = candidatePoints.length > maxPoints ? candidatePoints.filter((_, i) => i % Math.ceil(candidatePoints.length / maxPoints) === 0) : candidatePoints;
        let currentP = actualPoints[0];
        optimizedPoints.push(currentP);
        let remainingCount = actualPoints.length - 1;
        actualPoints[0] = actualPoints[remainingCount];

        while (remainingCount > 0) {
            let closestIdx = -1;
            let minDistSq = Infinity;
            const searchLimit = Math.min(remainingCount, 500);
            for (let i = 0; i < searchLimit; i++) {
                const p = actualPoints[i];
                const dpx = p.px - currentP.px;
                const dpy = p.py - currentP.py;
                const distSq = dpx * dpx + dpy * dpy;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closestIdx = i;
                }
                if (distSq <= 2) break;
            }
            const nextP = actualPoints[closestIdx];
            actualPoints[closestIdx] = actualPoints[remainingCount - 1];
            remainingCount--;
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

        return { points: applyRenderingStyle(optimizedPoints, params) };
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
            ...params,
            text: sourceName || 'Spout Input',
            x, y, r, g, b,
            fontSize: 72 * scale,
            numPoints: 100
        };
        
        return await generateText(textParams, fontBuffer);
    } catch (error) {
        console.error('Error in generateSpoutReceiver:', error);
        throw error;
    }
}

export function generateSinewave(params) {
  try {
    const { amplitude, frequency, phase, width, numPoints, x, y, r, g, b } = withDefaults(params, {
      amplitude: 0.5,
      frequency: 1,
      phase: 0,
      width: 2.0,
      numPoints: 50,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255
    });

    const points = [];
    const startX = -width / 2;
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const curX = startX + t * width;
      const curY = amplitude * Math.sin(frequency * (curX * Math.PI) + phase);
      points.push({
        x: curX + x,
        y: curY + y,
        r, g, b
      });
    }

    return { points: applyRenderingStyle(points, params) };
  } catch (error) {
    console.error('Error in generateSinewave:', error);
    throw error;
  }
}