import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

import { SharedWorkerProvider } from './contexts/WorkerContext.jsx';
import { IldaParserWorkerProvider } from './contexts/IldaParserWorkerContext.jsx';
import { GeneratorWorkerProvider } from './contexts/GeneratorWorkerContext.jsx'; // Import GeneratorWorkerProvider
import { ThumbnailWorkerProvider } from './contexts/ThumbnailWorkerContext.jsx';
import { AudioProvider } from './contexts/AudioContext.jsx';
import { TimelineProvider } from './contexts/TimelineContext.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
    <SharedWorkerProvider>
      <IldaParserWorkerProvider>
        <GeneratorWorkerProvider> {/* Wrap App with GeneratorWorkerProvider */}
          <ThumbnailWorkerProvider>
            <AudioProvider>
              <TimelineProvider>
                <App />
              </TimelineProvider>
            </AudioProvider>
          </ThumbnailWorkerProvider>
        </GeneratorWorkerProvider>
      </IldaParserWorkerProvider>
    </SharedWorkerProvider>
);