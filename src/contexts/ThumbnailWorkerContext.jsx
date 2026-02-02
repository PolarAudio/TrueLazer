import React, { createContext, useContext, useEffect, useState } from 'react';

const ThumbnailWorkerContext = createContext(null);

export const useThumbnailWorker = () => {
  return useContext(ThumbnailWorkerContext);
};

export const ThumbnailWorkerProvider = ({ children }) => {
  const [thumbnailWorker, setThumbnailWorker] = useState(null);

  useEffect(() => {
    if (!thumbnailWorker) {
      // Use the same worker script but a separate instance
      const worker = new Worker(new URL('../utils/ilda-parser.worker.js', import.meta.url));
      setThumbnailWorker(worker);
    }

    return () => {
      if (thumbnailWorker) {
        thumbnailWorker.terminate();
      }
    };
  }, [thumbnailWorker]);

  return (
    <ThumbnailWorkerContext.Provider value={thumbnailWorker}>
      {children}
    </ThumbnailWorkerContext.Provider>
  );
};
