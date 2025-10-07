export async function generateFrame(generator) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./generators.worker.js', import.meta.url));
    worker.postMessage({ type: 'generate-frame', generator, params: generator.params });
    worker.onmessage = (e) => {
      if (e.data.success) {
        resolve(e.data.frame);
      } else {
        reject(new Error(e.data.error));
      }
      worker.terminate();
    };
    worker.onerror = (error) => {
      reject(error);
      worker.terminate();
    };
  });
}