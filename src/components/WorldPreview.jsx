import React, { useEffect, useRef } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const WorldPreview = ({ worldData, showBeamEffect, beamAlpha, drawSpeed }) => {
  const canvasRef = useRef(null);
  const worker = useWorker();
  const canvasId = useRef(`world-preview-${Math.random()}`);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worker) return;

    const offscreen = canvas.transferControlToOffscreen();
    
    worker.postMessage({
      action: 'register',
      payload: {
        id: canvasId.current,
        canvas: offscreen,
        type: 'world',
        data: { worldData, showBeamEffect, beamAlpha, drawSpeed }
      }
    }, [offscreen]);

    return () => {
      worker.postMessage({ action: 'deregister', payload: { id: canvasId.current } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!worker) return;
    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { worldData, showBeamEffect, beamAlpha, drawSpeed }
      }
    });
  }, [worker, worldData, showBeamEffect, beamAlpha, drawSpeed]);

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default WorldPreview;