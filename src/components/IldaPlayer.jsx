import React, { useEffect, useRef, useState } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const IldaPlayer = ({ ildaWorkerId, totalFrames, showBeamEffect, beamAlpha, drawSpeed, onFrameChange, ildaParserWorker }) => {
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
        data: { showBeamEffect, beamAlpha, drawSpeed }
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
    if (!ildaParserWorker || !ildaWorkerId || totalFrames === 0) {
      setCurrentFrame(null);
      return;
    }

    let frameIndex = 0; // Start with the first frame

    const fetchFrame = () => {
      if (ildaParserWorker && ildaWorkerId && totalFrames > 0) {
        ildaParserWorker.postMessage({ type: 'get-frame', workerId: ildaWorkerId, frameIndex });
      }
    };

    const messageHandler = (e) => {
      if (e.data.type === 'get-frame' && e.data.workerId === ildaWorkerId) {
        setCurrentFrame(e.data.frame);
        // Advance frameIndex for the next request
        frameIndex = (frameIndex + 1) % totalFrames;
      }
    };

    ildaParserWorker.addEventListener('message', messageHandler);

    // Initial fetch
    fetchFrame();

    // Set up interval for fetching subsequent frames
    const intervalId = setInterval(fetchFrame, drawSpeed); // Use drawSpeed for fetching interval

    return () => {
      clearInterval(intervalId);
      ildaParserWorker.removeEventListener('message', messageHandler);
    };
  }, [ildaParserWorker, ildaWorkerId, totalFrames, drawSpeed]);

  useEffect(() => {
    if (!worker || !currentFrame) return;
    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { ildaFrames: [currentFrame], showBeamEffect, beamAlpha, drawSpeed }
      }
    });
  }, [worker, currentFrame, showBeamEffect, beamAlpha, drawSpeed]);

  return (
    <div className="ilda-player">
      <h3>Selected Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default React.memo(IldaPlayer);