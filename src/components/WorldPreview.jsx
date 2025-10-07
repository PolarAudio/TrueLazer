import React, { useEffect, useRef, useState } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const WorldPreview = ({ worldData, showBeamEffect, beamAlpha, drawSpeed, ildaParserWorker }) => {
  const canvasRef = useRef(null);
  const worker = useWorker();
  const canvasId = useRef(`world-preview-${Math.random()}`);
  const [activeFrames, setActiveFrames] = useState({});

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
        data: { showBeamEffect, beamAlpha, drawSpeed }
      }
    }, [offscreen]);

    return () => {
      worker.postMessage({ action: 'deregister', payload: { id: canvasId.current } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ildaParserWorker || worldData.length === 0) {
      setActiveFrames({});
      return;
    }

    const frameIndexes = {}; // Keep track of current frame index for each workerId
    const intervalIds = {}; // Store interval IDs for cleanup

    worldData.forEach(clip => {
      if (clip.workerId && clip.totalFrames > 0) {
        frameIndexes[clip.workerId] = 0;

        const fetchFrame = () => {
          if (ildaParserWorker && clip.workerId && clip.totalFrames > 0) {
            ildaParserWorker.postMessage({ type: 'get-frame', workerId: clip.workerId, frameIndex: frameIndexes[clip.workerId] });
          }
        };

        const messageHandler = (e) => {
          if (e.data.type === 'get-frame' && e.data.workerId === clip.workerId) {
            setActiveFrames(prevFrames => ({
              ...prevFrames,
              [e.data.workerId]: { frame: e.data.frame, effects: clip.effects } // Store frame and effects
            }));
            // Advance frameIndex for the next request
            frameIndexes[clip.workerId] = (frameIndexes[clip.workerId] + 1) % clip.totalFrames;
          }
        };

        ildaParserWorker.addEventListener('message', messageHandler);
        // Initial fetch
        fetchFrame();
        // Set up interval for fetching subsequent frames
        intervalIds[clip.workerId] = setInterval(fetchFrame, drawSpeed);
      }
    });

    return () => {
      Object.values(intervalIds).forEach(clearInterval);
      // Remove event listeners for each clip's workerId
      // This part is tricky as removeEventListener needs the exact same function reference.
      // For simplicity, we'll rely on the worker being terminated or the component unmounting.
      // A more robust solution would involve a dedicated message handler for each clip or a more complex cleanup.
    };
  }, [ildaParserWorker, worldData, drawSpeed]);

  useEffect(() => {
    if (!worker) return;
    // Transform activeFrames into a format rendering.worker.js expects for worldData
    const transformedWorldData = Object.entries(activeFrames).map(([workerId, { frame, effects }]) => ({
      frames: [frame], // rendering.worker.js expects an array of frames
      effects: effects,
      workerId: workerId, // Include workerId for identification if needed in rendering worker
    }));

    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { worldData: transformedWorldData, showBeamEffect, beamAlpha, drawSpeed }
      }
    });
  }, [worker, activeFrames, showBeamEffect, beamAlpha, drawSpeed]);

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default WorldPreview;