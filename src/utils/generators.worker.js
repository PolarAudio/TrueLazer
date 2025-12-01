import { generateCircle, generateSquare, generateLine, generateText, generateStar } from './generators.js';

self.onmessage = async (event) => {
  const { type, generator, layerIndex, colIndex } = event.data;
  const params = generator.params;

  try {
    let frame;
    switch (type) {
      case 'generate-frame':
        try {
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
        } catch (generatorError) {
          console.error(`Error generating frame for ${generator.name}:`, generatorError);
          frame = { points: [] }; // Ensure a frame is still returned, even on error
          self.postMessage({ success: false, error: generatorError.message, layerIndex, colIndex });
          return; // Stop further processing if generator function errors
        }
        self.postMessage({ success: true, frame, generator, params, layerIndex, colIndex });
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
