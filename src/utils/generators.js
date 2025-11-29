import opentype from 'opentype.js';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

export async function generateText(params) {
  try {
    const { text, x, y, r, g, b, blanking, fontSize, fontUrl } = withDefaults(params, {
      text: 'Hello',
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255,
      blanking: false,
      fontSize: 72,
      fontUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto-Regular.ttf',
    });

    const font = await opentype.load(fontUrl);
    const path = font.getPath(text, 0, 0, fontSize);
    const points = path.commands.map(command => {
      if (command.type !== 'Z') {
        return { x: command.x / 1000 + x, y: -command.y / 1000 + y, r, g, b, blanking };
      }
      return null;
    }).filter(p => p);

    return { points };
  } catch (error) {
    console.error('Error in generateText:', error);
    throw error;
  }
}

export function generateCircle(params) {
  try {
    const { radius, numPoints, x, y, r, g, b, blanking } = withDefaults(params, {
      radius: 0.5,
      numPoints: 100,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255,
      blanking: false,
    });

    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      points.push({
        x: radius * Math.cos(angle) + x,
        y: radius * Math.sin(angle) + y,
        r, g, b, blanking
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
    const { width, height, x, y, r, g, b, blanking } = withDefaults(params, {
      width: 0.5,
      height: 0.5,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255,
      blanking: false,
    });

    const points = [
      { x: -width / 2 + x, y: -height / 2 + y, r, g, b, blanking },
      { x: width / 2 + x, y: -height / 2 + y, r, g, b, blanking },
      { x: width / 2 + x, y: height / 2 + y, r, g, b, blanking },
      { x: -width / 2 + x, y: height / 2 + y, r, g, b, blanking },
      { x: -width / 2 + x, y: -height / 2 + y, r, g, b, blanking },
    ];

    return { points };
  } catch (error) {
    console.error('Error in generateSquare:', error);
    throw error;
  }
}

export function generateLine(params) {
  try {
    const { x1, y1, x2, y2, r, g, b, blanking } = withDefaults(params, {
      x1: -0.5,
      y1: 0,
      x2: 0.5,
      y2: 0,
      r: 255,
      g: 255,
      b: 255,
      blanking: false,
    });

    const points = [
      { x: x1, y: y1, r, g, b, blanking },
      { x: x2, y: y2, r, g, b, blanking },
    ];

    return { points };
  } catch (error) {
    console.error('Error in generateLine:', error);
    throw error;
  }
}

export function generateStar(params) {
  try {
    const { outerRadius, innerRadius, numPoints, x, y, r, g, b, blanking } = withDefaults(params, {
      outerRadius: 0.5,
      innerRadius: 0.2,
      numPoints: 5,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255,
      blanking: false,
    });

    const points = [];
    for (let i = 0; i < numPoints * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (numPoints * 2)) * 2 * Math.PI - Math.PI / 2;
      points.push({
        x: radius * Math.cos(angle) + x,
        y: radius * Math.sin(angle) + y,
        r, g, b, blanking
      });
    }
    points.push({ ...points[0] });

    return { points };
  } catch (error) {
    console.error('Error in generateStar:', error);
    throw error;
  }
}