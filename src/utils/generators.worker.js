import { generateCircle, generateSquare, generateLine, generateText, generateStar } from './generators.js';

self.onmessage = async (event) => {
  const { type, layerIndex, colIndex, generator, params } = event.data;
  // 'generator' here is the full generatorDefinition from App.jsx

  try {
    let frames;
    // Use incoming params if they exist, otherwise fall back to defaults
    let currentParams = params || generator.defaultParams;

    switch (type) {
      case 'generate': // Change this from 'generate-frame'
        try {
          switch (generator.id) { // Use generator.id for switch
            case 'circle':
              frames = [generateCircle(currentParams)]; // Wrap in array as it's a single frame
              break;
            case 'square':
              frames = [generateSquare(currentParams)];
              break;
            case 'line':
              frames = [generateLine(currentParams)];
              break;
            case 'text':
              frames = [await generateText(currentParams, event.data.fontBuffer)];
              break;
            case 'star':
              frames = [generateStar(currentParams)];
              break;
            default:
              frames = [{ points: [] }];
          }
        } catch (generatorError) {
          console.error(`Error generating frames for ${generator.name}:`, generatorError);
          frames = [{ points: [] }]; // Ensure frames array is still returned, even on error
          self.postMessage({ success: false, error: generatorError.message, layerIndex, colIndex });
          return;
        }
        self.postMessage({
          success: true,
          layerIndex,
          colIndex,
          frames,
          generatorDefinition: generator, // Send back the original definition
          currentParams: currentParams, // Send back the params used for generation
        });
        break;
      default:
        console.log('Worker: Received unknown message type:', type, 'Event data:', event.data);
        self.postMessage({ success: false, error: 'Unknown message type', layerIndex, colIndex });
    }
  } catch (error) {
    console.error('Worker: Uncaught error in onmessage handler:', error);
    self.postMessage({ success: false, error: error.message, layerIndex, colIndex });
  }
};
