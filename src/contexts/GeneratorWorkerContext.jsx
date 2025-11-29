import React, { createContext, useContext, useMemo, useEffect } from 'react';

const GeneratorWorkerContext = createContext(null);

export const GeneratorWorkerProvider = ({ children }) => {
  const generatorWorker = useMemo(() => {
    try {
      const worker = new Worker(new URL('../utils/generators.worker.js', import.meta.url), { type: 'module' });
      // console.log('GeneratorWorkerProvider: Worker created successfully:', worker); // Removed debug log
      worker.onerror = (error) => {
        console.error('Generator Worker instantiation or internal error:', error);
      };
      return worker;
    } catch (error) {
      console.error('Failed to create Generator Worker:', error);
      return null; // Ensure null is returned if creation fails
    }
  }, []);

  useEffect(() => {
    if (!generatorWorker) return;

    return () => {
      // console.log('GeneratorWorkerProvider: Terminating worker.'); // Removed debug log
      generatorWorker.terminate();
    };
  }, [generatorWorker]);

  // console.log('GeneratorWorkerProvider: Value passed to context provider:', generatorWorker); // Removed debug log

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
