import React, { useEffect, useRef } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const IldaPlayer = ({ ildaFrames, showBeamEffect, beamAlpha, drawSpeed, onFrameChange }) => {
  const canvasRef = useRef(null);
  const worker = useWorker();
  const canvasId = useRef(`ilda-player-${Math.random()}`);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worker) return;

    const offscreen = canvas.transferControlToOffscreen();
    
    worker.postMessage({
      action: 'register',
      payload: {
        id: canvasId.current,
        canvas: offscreen,
        type: 'single',
        data: { ildaFrames, showBeamEffect, beamAlpha, drawSpeed }
      }
    }, [offscreen]);

    const messageHandler = (e) => {
      if (e.data.type === 'frameChange' && e.data.id === canvasId.current && onFrameChange) {
        onFrameChange(e.data.frameIndex);
      }
    };
    worker.addEventListener('message', messageHandler);

    return () => {
      worker.removeEventListener('message', messageHandler);
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
        data: { ildaFrames, showBeamEffect, beamAlpha, drawSpeed }
      }
    });
  }, [worker, ildaFrames, showBeamEffect, beamAlpha, drawSpeed]);

  return (
    <div className="ilda-player">
      <h3>Selected Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default React.memo(IldaPlayer);