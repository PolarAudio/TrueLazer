import React, { useRef, useEffect, useState, useCallback } from 'react';
import { WebGLRenderer } from '../utils/WebGLRenderer';
import { applyEffects } from '../utils/effects';

const FPS = 30;

const IldaThumbnail = ({ frame, frames: framesProp, effects, progress = 0, width = 100, height = 100, ildaParserWorker, workerId, syncSettings = {}, clipDuration, bpm = 120, fftLevels, liveFramesRef, progressRef, cycleFrames, cycleInterval = 0, cycleEnabled = false, liveEnabled = true }) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const rafRef = useRef(null);
  const localFramesRef = useRef([]);
  const effectStatesRef = useRef(new Map());
  const lastRenderedRef = useRef(null); // Reference of the last live frame rendered
  const [fetchedFrames, setFetchedFrames] = useState(null);
  const mountedRef = useRef(true);

  // Live render context kept in a ref so the poll loop always reads the latest
  // values (effects, sync settings, duration, etc.) without needing to restart.
  const liveCtxRef = useRef({ effects, progress, syncSettings, clipDuration, bpm, fftLevels });
  useEffect(() => {
    liveCtxRef.current = { effects, progress, syncSettings, clipDuration, bpm, fftLevels };
  }, [effects, progress, syncSettings, clipDuration, bpm, fftLevels]);

  // Clear per-clip state when the thumbnail is reassigned to a different clip.
  useEffect(() => {
    lastRenderedRef.current = null;
    effectStatesRef.current = new Map();
  }, [workerId]);

  // Request all frames from worker when workerId is available (skip position-based
  // generator keys — those aren't ILDA workers).
  useEffect(() => {
    if (!workerId || !ildaParserWorker || String(workerId).startsWith('generator-')) {
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

    try {
      renderer.render({
        ildaFrames: framesToRender, previewScanRate: 1, intensity: 1,
        effects: [], syncSettings: {}
      });
    } catch (err) {
      // A single bad frame must not kill the thumbnail's playback loop — it
      // would otherwise freeze the preview permanently (next rAF/timeout is
      // scheduled only after render() returns).
      console.error('[IldaThumbnail] render error:', err);
    }
  }, []);

  // Render a single frame through the thumbnail's effect pipeline (clone before
  // mutating, apply effects with the live sync/timing context).
  const renderOne = useCallback((frameToRender, liveProgressOverride) => {
    const renderer = rendererRef.current;
    if (!renderer || !mountedRef.current || !frameToRender) return;
    try {
      const ctx = liveCtxRef.current;
      const hasEffects = ctx.effects && ctx.effects.length > 0;

      if (!hasEffects) {
        renderFrames([frameToRender]);
        return;
      }

      const pts = frameToRender.points;
      const isTyped = frameToRender.isTypedArray || pts instanceof Float32Array;
      const newPoints = isTyped ? new Float32Array(pts) : (pts ? pts.map(p => ({ ...p })) : []);
      const fxContext = {
        time: performance.now(),
        progress: liveProgressOverride !== undefined ? liveProgressOverride : ctx.progress,
        effectStates: effectStatesRef.current,
        syncSettings: ctx.syncSettings,
        bpm: ctx.bpm,
        fftLevels: ctx.fftLevels
      };
      if (ctx.clipDuration !== undefined) fxContext.clipDuration = ctx.clipDuration;

      const target = applyEffects({ ...frameToRender, points: newPoints, isTypedArray: isTyped }, ctx.effects, fxContext);
      renderFrames([target]);
    } catch (err) {
      console.error('[IldaThumbnail] effect/render error:', err);
    }
  }, [renderFrames]);

  // Initial render: show the current live frame (or the supplied frame) immediately,
  // and keep the fixed-30fps list cycling only as a fallback when no live wiring is present.
  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const renderer = rendererRef.current;
    if (!renderer) return;

    if (liveFramesRef && workerId) {
      const live = liveFramesRef.current[workerId];
      if (live) {
        renderOne(live);
        return;
      }
    }
    if (frame) {
      renderOne(frame);
      return;
    }

    const rawFrames = framesProp && framesProp.length > 0
      ? framesProp
      : (fetchedFrames && fetchedFrames.length > 0 ? fetchedFrames : []);
    if (rawFrames.length === 0) return;

    const ctx = liveCtxRef.current;
    const hasEffects = ctx.effects && ctx.effects.length > 0;
    let processed = rawFrames;
    if (hasEffects) {
      const fxContext = {
        time: performance.now(),
        progress,
        effectStates: effectStatesRef.current,
        syncSettings: ctx.syncSettings,
        bpm: ctx.bpm,
        fftLevels: ctx.fftLevels
      };
      if (ctx.clipDuration !== undefined) fxContext.clipDuration = ctx.clipDuration;
      try {
        processed = rawFrames.map(f => {
          const fpts = f.points;
          const isTyped = f.isTypedArray || fpts instanceof Float32Array;
          const newPoints = isTyped ? new Float32Array(fpts) : fpts.map(p => ({ ...p }));
          return applyEffects({ ...f, points: newPoints, isTypedArray: isTyped }, ctx.effects, fxContext);
        });
      } catch (err) {
        // One frame failing effect application must not blank the whole
        // thumbnail — fall back to the raw frames so the clip stays visible.
        console.error('[IldaThumbnail] effect error on init:', err);
        processed = rawFrames;
      }
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
  }, [frame, framesProp, fetchedFrames, effects, progress, renderFrames, renderOne, syncSettings, clipDuration, bpm, fftLevels, liveFramesRef, workerId]);

  // Playback driver: shows the live output frame whenever it changes (active /
  // hovered / selected clips, and flash clips running in the background). For clips
  // that have frames but no live activity, it drives a self-contained preview cycle
  // so every thumbnail animates in live-render mode at the clip's OWN playback speed
  // (cycleInterval is derived from the same speed-sync duration the output loop uses).
  useEffect(() => {
    const liveWired = liveEnabled && liveFramesRef && workerId;
    const canCycle = cycleEnabled && cycleFrames && cycleFrames.length > 1 && cycleInterval > 0;
    if (!liveWired && !canCycle) return;

    let timer = 0;
    let lastTime = performance.now();
    let cycleAccum = 0;
    let cycleIndex = 0;
    // Adaptive pacing: when the live frame is not actually changing (nothing playing,
    // static preview), backs off to THUMB_IDLE_MS so N idle thumbnails don't each spin
    // a permanent 60fps rAF (that summed to the biggest source of background allocation
    // on an idle deck). Any actual frame change snaps back to 16ms immediately.
    let currentDelay = 16;
    const THUMB_IDLE_MS = 200;

    const tick = () => {
      let didRender = false;

      if (liveWired) {
        const live = liveFramesRef.current[workerId];
        if (live && live !== lastRenderedRef.current && mountedRef.current) {
          lastRenderedRef.current = live;
          cycleAccum = 0;
          const liveProgress = progressRef ? (progressRef.current[workerId] || 0) : undefined;
          renderOne(live, liveProgress);
          didRender = true;
          timer = setTimeout(tick, 16);
          return;
        }
      }

      // No changing live frame right now — advance the local preview cycle instead.
      if (canCycle && mountedRef.current) {
        const now = performance.now();
        const dt = now - lastTime;
        lastTime = now;
        cycleAccum += dt;
        if (cycleAccum >= cycleInterval) {
          cycleAccum %= cycleInterval;
          cycleIndex = (cycleIndex + 1) % cycleFrames.length;
          const frameToShow = cycleFrames[cycleIndex];
          if (frameToShow && frameToShow !== lastRenderedRef.current) {
            lastRenderedRef.current = frameToShow;
            renderOne(frameToShow);
            didRender = true;
          }
        }
      }

      currentDelay = didRender ? 16 : Math.min(THUMB_IDLE_MS, currentDelay * 2);
      timer = setTimeout(tick, currentDelay);
    };
    timer = setTimeout(tick, currentDelay);
    return () => clearTimeout(timer);
  }, [workerId, liveFramesRef, progressRef, renderOne, cycleEnabled, cycleFrames, cycleInterval, liveEnabled]);

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