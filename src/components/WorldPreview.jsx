import React, { useEffect, useRef, useState } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const WorldPreview = ({ worldData, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, drawSpeed, ildaParserWorker }) => {
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
        data: { showBeamEffect, beamAlpha, fadeAlpha, previewScanRate }
      }
    }, [offscreen]);

    return () => {
      worker.postMessage({ action: 'deregister', payload: { id: canvasId.current } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ildaParserWorker) {
      setActiveFrames({});
      return;
    }

    const currentFrameIndexes = {};
    const currentIntervalIds = {};

    const handleIldaParserMessage = (e) => {
      if (e.data.type === 'get-frame') {
        const { workerId, frame, effects } = e.data;
        setActiveFrames(prevFrames => {
          const isWorkerIdActive = worldData.some(clip => clip.workerId === workerId);
          if (isWorkerIdActive) {
            const existingFrameData = prevFrames[workerId];
            // Only update if the frame data has actually changed (deep comparison for objects)
            if (!existingFrameData || JSON.stringify(existingFrameData.frame) !== JSON.stringify(frame) || JSON.stringify(existingFrameData.effects) !== JSON.stringify(effects)) {
              return {
                ...prevFrames,
                [workerId]: { frame, effects } // Store frame and effects
              };
            }
          }
          return prevFrames;
        });
      }
    };

    ildaParserWorker.addEventListener('message', handleIldaParserMessage);

    // Initialize or update frame fetching for current worldData
    const newActiveFrames = {};
    worldData.forEach(clip => {
      if (clip && clip.workerId && clip.totalFrames > 0) {
        currentFrameIndexes[clip.workerId] = 0;
        newActiveFrames[clip.workerId] = activeFrames[clip.workerId] || { frame: null, effects: clip.effects }; // Preserve existing frame if available

        const fetchFrame = () => {
          if (ildaParserWorker && clip.workerId && clip.totalFrames > 0) {
            ildaParserWorker.postMessage({ type: 'get-frame', workerId: clip.workerId, frameIndex: currentFrameIndexes[clip.workerId] });
            currentFrameIndexes[clip.workerId] = (currentFrameIndexes[clip.workerId] + 1) % clip.totalFrames;
          }
        };

        // Clear existing interval for this workerId if it exists
        if (currentIntervalIds[clip.workerId]) {
          clearInterval(currentIntervalIds[clip.workerId]);
        }
        // Initial fetch
        fetchFrame();
        // Set up interval for fetching subsequent frames
        currentIntervalIds[clip.workerId] = setInterval(fetchFrame, drawSpeed);
      } else {
        // Explicitly clear the canvas in the rendering worker for this clip
        if (worker && clip && clip.workerId) {
          worker.postMessage({ action: 'clear', payload: { id: `world-preview-${clip.workerId}` } }); // Assuming a unique ID for each clip's rendering
        }
      }
    });

    // Clean up intervals for clips that are no longer in worldData
    Object.keys(activeFrames).forEach(workerId => {
      if (!newActiveFrames[workerId]) {
        if (currentIntervalIds[workerId]) {
          clearInterval(currentIntervalIds[workerId]);
          delete currentIntervalIds[workerId];
        }
        // Also remove from activeFrames if it's no longer active
        setActiveFrames(prevFrames => {
          const updatedFrames = { ...prevFrames };
          delete updatedFrames[workerId];
          return updatedFrames;
        });
        // Explicitly clear the canvas in the rendering worker for this workerId
        if (worker) {
          worker.postMessage({ action: 'clear', payload: { id: `world-preview-${workerId}` } });
        }
      }
    });

    // If worldData is empty, clear all active frames and send a clear message to the worker
    if (worldData.length === 0) {
      setActiveFrames({});
      if (worker) {
        worker.postMessage({ action: 'clear', payload: { id: canvasId.current } });
      }
    }

    // Update activeFrames to reflect only currently active clips
    // This line needs to be carefully placed to avoid overwriting during the loop
    // It's better to manage newActiveFrames directly and then set it once.
    // For now, let's assume setActiveFrames inside the loop is sufficient for individual updates.

    // After all processing, ensure activeFrames only contains relevant clips
    setActiveFrames(prevFrames => {
      const updatedFrames = {};
      worldData.forEach(clip => {
        if (clip && clip.workerId && prevFrames[clip.workerId]) {
          updatedFrames[clip.workerId] = prevFrames[clip.workerId];
        }
      });
      return updatedFrames;
    });

    return () => {
      ildaParserWorker.removeEventListener('message', handleIldaParserMessage);
      Object.values(currentIntervalIds).forEach(clearInterval);
    };
  }, [ildaParserWorker, worldData, drawSpeed, worker, canvasId]);

  useEffect(() => {
    if (!worker) return;

    let transformedWorldData = [];
    if (Object.keys(activeFrames).length > 0) {
      transformedWorldData = Object.entries(activeFrames).map(([workerId, { frame, effects }]) => ({
        frames: [frame], // rendering.worker.js expects an array of frames
        effects: effects,
        workerId: workerId, // Include workerId for identification if needed in rendering worker
      }));
    }

    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { worldData: transformedWorldData, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate }
      }
    });
  }, [worker, activeFrames, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate]);

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default WorldPreview;