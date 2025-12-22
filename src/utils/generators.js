import opentype from 'opentype.js';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

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

    const font = opentype.parse(fontBuffer);
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

    commands.forEach(cmd => {
        if (cmd.type === 'M') {
            sampledPoints.push({ x: (cmd.x - midX) / 1000 + x, y: -(cmd.y - midY) / 1000 + y, r, g, b });
            prevX = cmd.x; prevY = cmd.y;
        } else if (cmd.type === 'L') {
            const dx = cmd.x - prevX;
            const dy = cmd.y - prevY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(1, Math.floor(dist * pointsPerUnit));
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                sampledPoints.push({ 
                    x: (prevX + dx * t - midX) / 1000 + x, 
                    y: -(prevY + dy * t - midY) / 1000 + y, 
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
                sampledPoints.push({ x: (cx - midX) / 1000 + x, y: -(cy - midY) / 1000 + y, r, g, b });
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
                sampledPoints.push({ x: (cx - midX) / 1000 + x, y: -(cy - midY) / 1000 + y, r, g, b });
            }
            prevX = cmd.x; prevY = cmd.y;
        }
    });

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

    return { points };
  } catch (error) {
    console.error('Error in generateStar:', error);
    throw error;
  }
}