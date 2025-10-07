import opentype from 'opentype.js';

async function generateText(params) {
  const text = params.text || 'Hello';
  // TODO: Make font path configurable or load from a predefined set
  const font = await opentype.load('C:/Windows/Fonts/arial.ttf');
  const path = font.getPath(text, 0, 0, 72);
  const points = path.commands.map(command => {
    if (command.type !== 'Z') {
      return { x: command.x / 1000, y: -command.y / 1000, r: 255, g: 255, b: 255, blanking: false };
    }
    return null;
  }).filter(p => p);

  return { points };
}

function generateCircle(params) {
  const points = [];
  const radius = params.radius || 0.5;
  const numPoints = params.numPoints || 100;

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    points.push({ x, y, r: 255, g: 255, b: 255, blanking: false });
  }

  return { points };
}

function generateSquare(params) {
  const points = [];
  const width = params.width || 0.5;
  const height = params.height || 0.5;

  points.push({ x: -width / 2, y: -height / 2, r: 255, g: 255, b: 255, blanking: false });
  points.push({ x: width / 2, y: -height / 2, r: 255, g: 255, b: 255, blanking: false });
  points.push({ x: width / 2, y: height / 2, r: 255, g: 255, b: 255, blanking: false });
  points.push({ x: -width / 2, y: height / 2, r: 255, g: 255, b: 255, blanking: false });
  points.push({ x: -width / 2, y: -height / 2, r: 255, g: 255, b: 255, blanking: false });

  return { points };
}

function generateLine(params) {
  const points = [];
  const x1 = params.x1 || -0.5;
  const y1 = params.y1 || 0;
  const x2 = params.x2 || 0.5;
  const y2 = params.y2 || 0;

  points.push({ x: x1, y: y1, r: 255, g: 255, b: 255, blanking: false });
  points.push({ x: x2, y: y2, r: 255, g: 255, b: 255, blanking: false });

  return { points };
}

function generateStar(params) {
  const points = [];
  const outerRadius = params.outerRadius || 0.5;
  const innerRadius = params.innerRadius || 0.2;
  const numPoints = params.numPoints || 5; // Number of points on the star

  for (let i = 0; i < numPoints * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (i / (numPoints * 2)) * 2 * Math.PI + Math.PI / 2; // Start at the top
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    points.push({ x, y, r: 255, g: 255, b: 255, blanking: false });
  }
  points.push(points[0]); // Close the star

  return { points };
}

self.onmessage = async (event) => {
  const { type, generator, params } = event.data;

  try {
    let frame;
    switch (type) {
      case 'generate-frame':
        switch (generator.name) {
          case 'circle':
            frame = generateCircle(params);
            break;
          case 'square':
            frame = generateSquare(params);
            break;
          case 'line':
            frame = generateLine(params);
            break;
          case 'text':
            frame = await generateText(params);
            break;
          case 'star':
            frame = generateStar(params);
            break;
          default:
            frame = { points: [] };
        }
        self.postMessage({ success: true, frame });
        break;
      default:
        self.postMessage({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    self.postMessage({ success: false, error: error.message });
  }
};