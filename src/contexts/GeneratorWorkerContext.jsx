import React, { createContext, useContext, useMemo } from 'react';

const GeneratorWorkerContext = createContext(null);

export const GeneratorWorkerProvider = ({ children }) => {
  const generatorWorker = useMemo(() => {
    // Using a URL for the worker script, compatible with Vite
    return new Worker(new URL('../utils/generators.worker.js', import.meta.url), { type: 'module' });
  }, []);

  // Optional: Handle worker errors or messages globally if needed
  // useEffect(() => {
  //   generatorWorker.onerror = (error) => {
  //     console.error('Generator Worker error:', error);
  //   };
  //   return () => {
  //     generatorWorker.terminate();
  //   };
  // }, [generatorWorker]);

  return (
    <GeneratorWorkerContext.Provider value={generatorWorker}>
      {children}
    </GeneratorWorkerContext.Provider>
  );
};

export const useGeneratorWorker = () => {
  const context = useContext(GeneratorWorkerContext);
  if (context === undefined) {
    throw new Error('useGeneratorWorker must be used within a GeneratorWorkerProvider');
  }
  return context;
};
