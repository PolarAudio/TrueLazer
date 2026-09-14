import React, { useRef, useEffect, useState, useCallback } from 'react';
import { WebGLRenderer } from '../utils/WebGLRenderer';
import { applyEffects } from '../utils/effects';

const FPS = 30;

const IldaThumbnail = ({ frame, frames: framesProp, effects, width = 100, height = 100, ildaParserWorker, workerId }) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const rafRef = useRef(null);
  const localFramesRef = useRef([]);
  const [fetchedFrames, setFetchedFrames] = useState(null);
  const mountedRef = useRef(true);

  // Request all frames from worker when workerId is available
  useEffect(() => {
    if (!workerId || !ildaParserWorker) {
      setFetchedFrames(null);
      return;
    }

    let cancelled = false;
    const handler = (e) => {
      if (e.data.type === 'get-all-frames' && e.data.success && e.data.workerId === workerId) {
        if (!cancelled && mountedRef.current) {
          setFetchedFrames(e.data.frames);
        }
        ildaParserWorker.removeEventListener('message', handler);
      }
    };
    ildaParserWorker.addEventListener('message', handler);
    ildaParserWorker.postMessage({ type: 'get-all-frames', workerId });

    return () => {
      cancelled = true;
      ildaParserWorker.removeEventListener('message', handler);
    };
  }, [workerId, ildaParserWorker]);

  useEffect(() => {
    mountedRef.current = true;
    if (canvasRef.current && !rendererRef.current) {
      rendererRef.current = new WebGLRenderer(canvasRef.current, 'single');
    }
    return () => {
      mountedRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, []);

  const renderFrames = useCallback((framesToRender) => {
    const renderer = rendererRef.current;
    if (!renderer || !mountedRef.current) return;
    
    renderer.render({
      ildaFrames: framesToRender, previewScanRate: 1, intensity: 1,
      effects: [], syncSettings: {}
    });
  }, []);

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const renderer = rendererRef.current;
    if (!renderer) return;

    const rawFrames = framesProp && framesProp.length > 0
      ? framesProp
      : (fetchedFrames && fetchedFrames.length > 0
        ? fetchedFrames
        : (frame ? [frame] : []));
    if (rawFrames.length === 0) return;

    const hasEffects = effects && effects.length > 0;
    let processed = rawFrames;
    if (hasEffects) {
      processed = rawFrames.map(f => {
        const pts = f.points;
        const isTyped = f.isTypedArray || pts instanceof Float32Array;
        const newPoints = isTyped ? new Float32Array(pts) : pts.map(p => ({...p}));
        return applyEffects({ ...f, points: newPoints, isTypedArray: isTyped }, effects, {
          time: performance.now(), progress: 0, effectStates: new Map()
        });
      });
    }
    localFramesRef.current = processed;

    if (processed.length === 1) {
      renderFrames(processed);
      return;
    }

    const interval = 1000 / FPS;
    let lastTime = 0;
    const animate = (time) => {
      if (!mountedRef.current) return;
      if (time - lastTime >= interval) {
        lastTime = time;
        const frames = localFramesRef.current;
        if (frames.length > 0) {
          renderFrames(frames);
        }
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [frame, framesProp, fetchedFrames, effects, renderFrames]);

  return (
    <div className="clip-thumbnail" style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'black' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', backgroundColor: 'black' }}
      />
    </div>
  );
};

export default React.memo(IldaThumbnail);
