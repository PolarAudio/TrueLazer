import React, { useEffect, useRef, useState } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const IldaPlayer = ({ ildaWorkerId, totalFrames, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, drawSpeed, onFrameChange, ildaParserWorker }) => {
  const canvasRef = useRef(null);
  const worker = useWorker();
  const canvasId = useRef(`ilda-player-${Math.random()}`);
  const [currentFrame, setCurrentFrame] = useState(null);

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
        data: { showBeamEffect, beamAlpha, fadeAlpha, previewScanRate }
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
    if (!ildaParserWorker) {
      setCurrentFrame(null);
      return;
    }

    let frameIndex = 0;
    let intervalId = null;

    const handleIldaParserMessage = (e) => {
      if (e.data.type === 'get-frame' && e.data.workerId === ildaWorkerId) {
        // Only update if the frame data has actually changed (deep comparison for objects)
        if (!currentFrame || JSON.stringify(currentFrame) !== JSON.stringify(e.data.frame)) {
          setCurrentFrame(e.data.frame);
        }
      }
    };

    ildaParserWorker.addEventListener('message', handleIldaParserMessage);

    const setupFrameFetching = () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (ildaWorkerId && totalFrames > 0) {
        frameIndex = 0;
        const fetchFrame = () => {
          ildaParserWorker.postMessage({ type: 'get-frame', workerId: ildaWorkerId, frameIndex });
          frameIndex = (frameIndex + 1) % totalFrames;
        };
        fetchFrame(); // Initial fetch
        intervalId = setInterval(fetchFrame, drawSpeed);
      } else {
        setCurrentFrame(null);
        // Explicitly clear the canvas in the rendering worker
        if (worker) {
          worker.postMessage({ action: 'clear', payload: { id: canvasId.current } });
        }
      }
    };

    setupFrameFetching();

    return () => {
      ildaParserWorker.removeEventListener('message', handleIldaParserMessage);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [ildaParserWorker, ildaWorkerId, totalFrames, drawSpeed, worker, canvasId]);

  useEffect(() => {
    if (!worker) return;

    const framesToSend = currentFrame ? [currentFrame] : [];

    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { ildaFrames: framesToSend, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate }
      }
    });
  }, [worker, currentFrame, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate]);

  return (
    <div className="ilda-player">
      <h3>Selected Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default React.memo(IldaPlayer);