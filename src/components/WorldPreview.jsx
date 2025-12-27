import React, { useEffect, useRef, useState } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const WorldPreview = ({ activeFrames, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, layerIntensities, masterIntensity, dacSettings }) => {
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
        data: { showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode }
      }
    }, [offscreen]);

    return () => {
      worker.postMessage({ action: 'deregister', payload: { id: canvasId.current } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!worker) return;

    const transformedWorldData = Object.entries(activeFrames).map(([workerId, { frame, effects, layerIndex }]) => ({
      frames: [frame],
      effects: effects,
      workerId: workerId,
      layerIndex,
    }));

    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { worldData: transformedWorldData, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, layerIntensities, masterIntensity, dacSettings }
      }
    });
  }, [worker, activeFrames, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, layerIntensities, masterIntensity, dacSettings]);

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default WorldPreview;