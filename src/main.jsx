import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

import { SharedWorkerProvider } from './contexts/WorkerContext.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
    <SharedWorkerProvider>
      <App />
    </SharedWorkerProvider>
);
