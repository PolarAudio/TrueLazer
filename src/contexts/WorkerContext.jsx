import React, { createContext, useContext, useEffect, useRef } from 'react';

const WorkerContext = createContext(null);

export const useWorker = () => useContext(WorkerContext);

export const SharedWorkerProvider = ({ children }) => {
  const workerRef = useRef(null);

  if (workerRef.current === null) {
    workerRef.current = new Worker(new URL('../utils/rendering.worker.js', import.meta.url), { type: 'module' });
  }

  useEffect(() => {
    const worker = workerRef.current;
    return () => {
      worker.terminate();
    };
  }, []);

  return (
    <WorkerContext.Provider value={workerRef.current}>
      {children}
    </WorkerContext.Provider>
  );
};