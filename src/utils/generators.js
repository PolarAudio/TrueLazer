import opentype from 'opentype.js';

export async function generateText(params) {
  try {
    const text = params.text || 'Hello';
    const offsetX = params.x || 0;
    const offsetY = params.y || 0;
    const r = params.r !== undefined ? params.r : 255;
    const g = params.g !== undefined ? params.g : 255;
    const b = params.b !== undefined ? params.b : 255;
    const blanking = params.blanking !== undefined ? params.blanking : false;

    // TODO: Make font path configurable or load from a predefined set
    const font = await opentype.load('C:/Windows/Fonts/arial.ttf');
    const path = font.getPath(text, 0, 0, params.fontSize || 72);
    const points = path.commands.map(command => {
      if (command.type !== 'Z') {
        return { x: command.x / 1000 + offsetX, y: -command.y / 1000 + offsetY, r, g, b, blanking };
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
    const points = [];
    const radius = params.radius || 0.5;
    const numPoints = params.numPoints || 100;
    const offsetX = params.x || 0;
    const offsetY = params.y || 0;
    const r = params.r !== undefined ? params.r : 255;
    const g = params.g !== undefined ? params.g : 255;
    const b = params.b !== undefined ? params.b : 255;
    const blanking = params.blanking !== undefined ? params.blanking : false;

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const x = radius * Math.cos(angle) + offsetX;
      const y = radius * Math.sin(angle) + offsetY;
      points.push({ x, y, r, g, b, blanking });
    }
    return { points };
  } catch (error) {
    console.error('Error in generateCircle:', error);
    throw error;
  }
}

export function generateSquare(params) {
  try {
    const points = [];
    const width = params.width || 0.5;
    const height = params.height || 0.5;
    const offsetX = params.x || 0;
    const offsetY = params.y || 0;
    const r = params.r !== undefined ? params.r : 255;
    const g = params.g !== undefined ? params.g : 255;
    const b = params.b !== undefined ? params.b : 255;
    const blanking = params.blanking !== undefined ? params.blanking : false;

    points.push({ x: -width / 2 + offsetX, y: -height / 2 + offsetY, r, g, b, blanking });
    points.push({ x: width / 2 + offsetX, y: -height / 2 + offsetY, r, g, b, blanking });
    points.push({ x: width / 2 + offsetX, y: height / 2 + offsetY, r, g, b, blanking });
    points.push({ x: -width / 2 + offsetX, y: height / 2 + offsetY, r, g, b, blanking });
    points.push({ x: -width / 2 + offsetX, y: -height / 2 + offsetY, r, g, b, blanking }); // Close the square

    return { points };
  } catch (error) {
    console.error('Error in generateSquare:', error);
    throw error;
  }
}

export function generateLine(params) {
  try {
    const points = [];
    const x1 = params.x1 || -0.5;
    const y1 = params.y1 || 0;
    const x2 = params.x2 || 0.5;
    const y2 = params.y2 || 0;
    const offsetX = params.x || 0;
    const offsetY = params.y || 0;
    const r = params.r !== undefined ? params.r : 255;
    const g = params.g !== undefined ? params.g : 255;
    const b = params.b !== undefined ? params.b : 255;
    const blanking = params.blanking !== undefined ? params.blanking : false;

    points.push({ x: x1 + offsetX, y: y1 + offsetY, r, g, b, blanking });
    points.push({ x: x2 + offsetX, y: y2 + offsetY, r, g, b, blanking });

    return { points };
  } catch (error) {
    console.error('Error in generateLine:', error);
    throw error;
  }
}

export function generateStar(params) {
  try {
    const points = [];
    const outerRadius = params.outerRadius || 0.5;
    const innerRadius = params.innerRadius || 0.2;
    const numPoints = params.numPoints || 5; // Number of points on the star
    const offsetX = params.x || 0;
    const offsetY = params.y || 0;
    const r = params.r !== undefined ? params.r : 255;
    const g = params.g !== undefined ? params.g : 255;
    const b = params.b !== undefined ? params.b : 255;
    const blanking = params.blanking !== undefined ? params.blanking : false;

    for (let i = 0; i < numPoints * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (numPoints * 2)) * 2 * Math.PI - Math.PI / 2; // Start at the top
      const x = radius * Math.cos(angle) + offsetX;
      const y = radius * Math.sin(angle) + offsetY;
      points.push({ x, y, r, g, b, blanking });
    }
    points.push({ x: points[0].x, y: points[0].y, r, g, b, blanking }); // Close the star

    return { points };
  } catch (error) {
    console.error('Error in generateStar:', error);
    throw error;
  }
}