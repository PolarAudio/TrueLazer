import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const IldaParserWorkerContext = createContext(null);

export const useIldaParserWorker = () => {
  return useContext(IldaParserWorkerContext);
};

export const IldaParserWorkerProvider = ({ children }) => {
  const [ildaParserWorker, setIldaParserWorker] = useState(null);

  useEffect(() => {
    if (!ildaParserWorker) {
      const worker = new Worker(new URL('../utils/ilda-parser.worker.js', import.meta.url));
      setIldaParserWorker(worker);
    }

    return () => {
      if (ildaParserWorker) {
        ildaParserWorker.terminate();
      }
    };
  }, [ildaParserWorker]);

  return (
    <IldaParserWorkerContext.Provider value={ildaParserWorker}>
      {children}
    </IldaParserWorkerContext.Provider>
  );
};