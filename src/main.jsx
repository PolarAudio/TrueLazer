import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

import { SharedWorkerProvider } from './contexts/WorkerContext.jsx';
import { IldaParserWorkerProvider } from './contexts/IldaParserWorkerContext.jsx';
import { GeneratorWorkerProvider } from './contexts/GeneratorWorkerContext.jsx'; // Import GeneratorWorkerProvider

ReactDOM.createRoot(document.getElementById('root')).render(
    <SharedWorkerProvider>
      <IldaParserWorkerProvider>
        <GeneratorWorkerProvider> {/* Wrap App with GeneratorWorkerProvider */}
          <App />
        </GeneratorWorkerProvider>
      </IldaParserWorkerProvider>
    </SharedWorkerProvider>
);