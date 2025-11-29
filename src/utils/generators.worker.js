// console.log('generators.worker.js: Worker script started.'); // Confirm worker script execution

import opentype from 'opentype.js';

async function generateText(params) {
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

function generateCircle(params) {
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

function generateSquare(params) {
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

function generateLine(params) {
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

function generateStar(params) {
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

// self.onmessage = async (event) => {
//   console.log('Worker: Message received from main thread.'); // Log message receipt
//   const { type, generator, layerIndex, colIndex } = event.data;
//   const params = generator.params;

//   try {
//     let frame;
//     switch (type) {
//       case 'generate-frame':
//         try {
//           switch (generator.name) {
//             case 'circle':
//               frame = generateCircle(params);
//               break;
//             case 'square':
//               frame = generateSquare(params);
//               break;
//             case 'line':
//               frame = generateLine(params);
//               break;
//             case 'text':
//               frame = await generateText(params);
//               break;
//             case 'star':
//               frame = generateStar(params);
//               break;
//             default:
//               frame = { points: [] };
//           }
//         } catch (generatorError) {
//           console.error(`Error generating frame for ${generator.name}:`, generatorError);
//           frame = { points: [] }; // Ensure a frame is still returned, even on error
//           self.postMessage({ success: false, error: generatorError.message, layerIndex, colIndex });
//           return; // Stop further processing if generator function errors
//         }
//         self.postMessage({ success: true, frame, generator, params, layerIndex, colIndex });
//         break;
//       default:
//         console.log('Worker: Received unknown message type:', type, 'Event data:', event.data);
//         self.postMessage({ success: false, error: 'Unknown message type', layerIndex, colIndex });
//     }
//   } catch (error) {
//     console.error('Worker: Uncaught error in onmessage handler:', error);
//     self.postMessage({ success: false, error: error.message, layerIndex, colIndex });
//   }
// };
