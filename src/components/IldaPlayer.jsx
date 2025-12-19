import React, { useEffect, useRef, useState } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const IldaPlayer = ({ frame, effects, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, intensity }) => {
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
        data: { showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, intensity }
      }
    }, [offscreen]);

    return () => {
      worker.postMessage({ action: 'deregister', payload: { id: canvasId.current } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!worker) return;

    const framesToSend = frame ? [frame] : [];

    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { ildaFrames: framesToSend, effects: effects, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, intensity }
      }
    });
  }, [worker, frame, effects, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, intensity]);

  return (
    <div className="ilda-player">
      <h3>Selected Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default React.memo(IldaPlayer);