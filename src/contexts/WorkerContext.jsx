import React, { createContext, useContext, useEffect, useRef } from 'react';

const WorkerContext = createContext(null);

export const useWorker = () => useContext(WorkerContext);

export const SharedWorkerProvider = ({ children, onWorkerMessage }) => {
  const workerRef = useRef(null);

  if (workerRef.current === null) {
    workerRef.current = new Worker(new URL('../utils/rendering.worker.js', import.meta.url), { type: 'module' });
  }

  useEffect(() => {
    const worker = workerRef.current;
    if (onWorkerMessage) {
      worker.onmessage = onWorkerMessage;
    }
    return () => {
      worker.terminate();
      if (onWorkerMessage) {
        worker.onmessage = null; // Clean up the event listener
      }
    };
  }, [onWorkerMessage]);

  return (
    <WorkerContext.Provider value={workerRef.current}>
      {children}
    </WorkerContext.Provider>
  );
};