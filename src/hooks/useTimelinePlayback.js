import { useCallback, useEffect, useRef, useState } from 'react';
import { useTimeline, getTimelineDuration, getChannelOutputs, isChannelAudible } from '../contexts/TimelineContext';
import { useIldaParserWorker } from '../contexts/IldaParserWorkerContext';
import { applyLanesToPoints } from '../utils/timelineAutomation';
import { selectActiveCue, buildGeneratorFrame, blankFrame } from '../utils/timelineCompile';
import { useTimelineSync } from './useTimelineSync';

/**
 * Transport + compile-to-DAC engine for the Timeline window.
 *
 * Clock: rAF while playing advances a wall-clock playhead (loop-aware).
 * Frame: at settings.fps the "active cue" on every routed, audible channel is
 *   compiled to canonical 8-float points, automation lanes are baked in, and
 *   the result is pushed via the app's normal `dac-frame-update` path (the
 *   main process re-sends at 30fps and auto-blanks on silence).
 *
 * ILDA frames are pulled from the shared parse worker (cached by workerId);
 * generator cues render synchronously with the shape generators here. This
 * keeps the engine dependency-free of the grid's live render path.
 */

function scaleRgb(points, factor) {
    if (factor === 1) return points;
    const out = new Float32Array(points);
    const n = points.length / 8;
    for (let i = 0; i < n; i++) {
        out[i * 8 + 3] = points[i * 8 + 3] * factor;
        out[i * 8 + 4] = points[i * 8 + 4] * factor;
        out[i * 8 + 5] = points[i * 8 + 5] * factor;
    }
    return out;
}

// Channel-level axis invert: negate X and/or Y around 0 (native coordinates).
export function flipPoints(points, flipX, flipY) {
    if (!flipX && !flipY) return points;
    const out = new Float32Array(points);
    const n = points.length / 8;
    for (let i = 0; i < n; i++) {
        if (flipX) out[i * 8] = -out[i * 8];
        if (flipY) out[i * 8 + 1] = -out[i * 8 + 1];
    }
    return out;
}

export function useTimelinePlayback() {
    const { state, actions } = useTimeline();
    const ildaParserWorker = useIldaParserWorker();
    const sync = useTimelineSync();

    const [isPlaying, setIsPlaying] = useState(false);
    const [playheadSec, setPlayheadSec] = useState(0);
    const [laserOn, setLaserOnState] = useState(false);

    const stateRef = useRef(state);
    stateRef.current = state;

    const playheadRef = useRef(0);
    const accRef = useRef(0);
    const laserOnRef = useRef(false);
    const isPlayingRef = useRef(false);
    const syncRef = useRef(sync);
    syncRef.current = sync;

    const ildaLiveRef = useRef(new Map()); // workerId -> { idx, frame }
    const ildaRequestedRef = useRef(new Map()); // workerId -> index already requested
    const parsingSentRef = useRef(new Set()); // filePath -> load-and-parse posted
    // filePath -> workerId parsed earlier THIS session. Persisted workerIds from
    // a previous session are stale (the worker's store is runtime-only), so a
    // reload must re-parse once and then every cue pointing at the file reuses
    // the live handle.
    const fileWorkerIdRef = useRef(new Map()); // filePath -> workerId

    // Collect unique DAC endpoints from routed channels so we can open/close
    // the wired connections and start/stop the main-process send loop.
    const getDacIps = useCallback(() => {
        const s = stateRef.current;
        const ips = new Map(); // ip -> type
        for (const chId of (s.channelOrder || [])) {
            const ch = s.channels[chId];
            for (const out of getChannelOutputs(ch)) {
                if (out?.ip) ips.set(out.ip, out.type || 'EtherDream');
            }
        }
        return ips;
    }, []);

    // --- ILDA bridge: adopt parse results + cache requested frames ---------
    useEffect(() => {
        if (!ildaParserWorker) return;
        const handler = (e) => {
            const d = e.data;
            if (!d) return;
            if (d.type === 'parse-ilda' && d.success) {
                fileWorkerIdRef.current.set(d.filePath, d.workerId);
                // Adopt the fresh session handle for EVERY cue on this file
                // (originals, pasted duplicates, and reopened projects).
                for (const c of Object.values(stateRef.current.cues)) {
                    if (c.type === 'ILDA' && c.filePath === d.filePath && c.workerId !== d.workerId) {
                        actions.updateCue(c.id, {
                            workerId: d.workerId,
                            totalFrames: d.totalFrames || c.totalFrames || 0,
                        });
                    }
                }
                return;
            }
            if (d.type === 'get-frame' && d.success && d.workerId != null) {
                if (d.frame != null) {
                    ildaLiveRef.current.set(d.workerId, { idx: d.frameIndex, frame: d.frame });
                }
            }
        };
        ildaParserWorker.addEventListener('message', handler);
        return () => ildaParserWorker.removeEventListener('message', handler);
    }, [ildaParserWorker, actions]);

    // --- ILDA bridge: request parses + rebind stale/pasted cues ------------
    // A cue whose workerId is not the live session handle for its file either
    // rebinds instantly (file already parsed this session) or triggers one
    // parse per file. Persisted workerIds always fail the live check, so they
    // re-parse exactly once per reload instead of erroring in get-frame.
    useEffect(() => {
        if (!ildaParserWorker) return;
        for (const cue of Object.values(state.cues)) {
            if (cue.type !== 'ILDA' || !cue.filePath) continue;
            const live = fileWorkerIdRef.current.get(cue.filePath);
            if (live) {
                if (cue.workerId !== live) {
                    actions.updateCue(cue.id, {
                        workerId: live,
                        totalFrames: cue.totalFrames || 0,
                    });
                }
                continue;
            }
            if (!parsingSentRef.current.has(cue.filePath)) {
                parsingSentRef.current.add(cue.filePath);
                ildaParserWorker.postMessage({
                    type: 'load-and-parse-ilda',
                    fileName: cue.fileName || cue.filePath.split(/[\\/]/).pop(),
                    filePath: cue.filePath,
                    browserFile: true,
                    stopAtFirstFrame: false,
                });
            }
        }
    }, [state.cues, ildaParserWorker]);

    // --- Cue frame builder --------------------------------------------------
    const buildCueFrame = useCallback((cue, t) => {
        if (cue.type === 'ILDA') {
            const wId = cue.workerId;
            if (!wId) return null;
            const totalFrames = Math.max(1, cue.totalFrames || 0);
            const fps = stateRef.current.settings.fps || 30;
            const interval = cue.totalFrames ? cue.duration / totalFrames : 1 / fps;
            const rel = t - cue.startTime;
            let idx = Math.floor(rel / Math.max(1e-4, interval));
            if (cue.isLooping) {
                idx = ((idx % totalFrames) + totalFrames) % totalFrames;
            } else {
                idx = Math.max(0, Math.min(idx, totalFrames - 1));
            }
            const live = ildaLiveRef.current.get(wId);
            // The worker's get-frame response wraps points in a metadata object
            // { points: Float32Array, isTypedArray, segments }. Unwrap so we hand
            // the compile/send path a canonical 8-float-per-point Float32Array —
            // shipping the wrapper down the DAC send path made Showbridge's
            // buildFrameChunks compute totalPoints = wrapper.length = undefined,
            // yielding NaN buffer sizes and a main-process RangeError crash.
            if (live && live.idx === idx) return live.frame && live.frame.points ? live.frame.points : live.frame;
            if (ildaParserWorker && ildaRequestedRef.current.get(wId) !== idx) {
                ildaRequestedRef.current.set(wId, idx);
                ildaParserWorker.postMessage({ type: 'get-frame', workerId: wId, frameIndex: idx, pageId: -1 });
            }
            return live ? (live.frame && live.frame.points ? live.frame.points : live.frame) : null; // last known frame while loading
        }
        // GENERATOR
        return buildGeneratorFrame(cue);
    }, [ildaParserWorker]);

    // --- Compile one channel at `t` into raw points ------------------------
    // Shared by the DAC fan-out and the editor preview so both always resolve
    // the exact same pixels (cue select + automation lanes + intensity +
    // master blackout), independent of the transport / laser state.
    const compileChannelFrame = useCallback((chId, t) => {
        const store = stateRef.current;
        const ch = store.channels[chId];
        if (!ch || !isChannelAudible(store, ch)) return null;
        if (getChannelOutputs(ch).length === 0) return null;

        const active = (ch.cues || [])
            .map((id) => store.cues[id])
            .filter(Boolean);
        const pick = selectActiveCue(active, t);
        let frame = null;
        if (pick) frame = buildCueFrame(pick, t);
        if (!frame) return null;

        const chLanes = (ch.automationLanes || [])
            .map((id) => store.lanes[id])
            .filter(Boolean);
        if (chLanes.length > 0) frame = applyLanesToPoints(frame, chLanes, t);
        if (ch.intensity !== 1) frame = scaleRgb(frame, ch.intensity);

        const s = store.settings;
        if (s.blackout || (s.masterIntensity || 1) <= 0) frame = blankFrame();
        else if (s.masterIntensity && s.masterIntensity !== 1) frame = scaleRgb(frame, s.masterIntensity);

        return frame;
    }, [buildCueFrame]);

    // --- Compile the whole timeline at `t` into framesToSend ---------------
    const compile = useCallback((t) => {
        const store = stateRef.current;
        const s = store.settings;
        const frames = {};
        const order = store.channelOrder || [];

        for (const chId of order) {
            const frame = compileChannelFrame(chId, t);
            if (!frame) continue;
            const outputs = getChannelOutputs(store.channels[chId]);
            // Dedupe repeated assignments; a zone may be given the same
            // output twice by drag ops.
            const seen = new Set();
            const uniq = outputs.filter((o) => {
                const k = `${o.ip}:${o.channel}`;
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });

            // One compiled frame, fanned out to every DAC channel of the zone.
            // Invert is per output so a wing (e.g. right laser) can flip while
            // its mirror-zone twin (left laser) stays native.
            for (const out of uniq) {
                const outFrame = out.flipX || out.flipY
                    ? flipPoints(frame, !!out.flipX, !!out.flipY)
                    : frame;
                frames[`${out.ip}:${out.channel}`] = {
                    points: outFrame,
                    ip: out.ip,
                    channel: out.channel,
                    type: out.type || 'EtherDream',
                    options: {
                        skipOptimization: false,
                        flipX: false,
                        flipY: false,
                        pps: 30000,
                        targetPps: 30000,
                        targetFps: s.fps || 30,
                        targetMode: 'varFpsFixedPps',
                    },
                };
            }
        }
        return frames;
    }, [compileChannelFrame]);

    const push = useCallback((t) => {
        const frames = compile(t);
        if (!window.electronAPI) return;
        if (Object.keys(frames).length > 0) {
            window.electronAPI.send('dac-frame-update', frames);
        }
    }, [compile]);

    // --- Clock --------------------------------------------------------------
    // Internal: rAF advances the playhead while playing. External: the playhead
    // tracks the sync source (with sub-frame extrapolation between updates)
    // whenever a signal is present, even when paused — so the ruler/preview
    // always reflects the show clock. Pushes stay gated on play + laser.
    useEffect(() => {
        const external = sync.source !== 'internal';
        const active = external ? sync.signal : isPlaying;
        if (!active) return;
        let raf;
        let last = performance.now();
        const tick = (now) => {
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            let t;
            if (external) {
                // Jump to the latest external sample, extrapolate past it.
                t = syncRef.current.seconds + Math.min(0.5, (now - syncRef.current.lastUpdate) / 1000);
            } else {
                t = playheadRef.current + dt;
                const s = stateRef.current.settings;
                const end = getTimelineDuration(stateRef.current);
                const loop = s.loopEnabled && s.loop && s.loop.end > s.loop.start
                    ? s.loop
                    : null;
                if (loop) {
                    const span = loop.end - loop.start;
                    if (t >= loop.end) t = loop.start + ((t - loop.start) % span);
                    if (t < loop.start) t = loop.end - ((loop.start - t) % span);
                } else if (t >= end) {
                    playheadRef.current = end;
                    setPlayheadSec(end);
                    setIsPlaying(false);
                    return;
                }
            }
            playheadRef.current = t;
            if (isPlayingRef.current && laserOnRef.current) {
                accRef.current += dt;
                const fps = stateRef.current.settings.fps || 30;
                if (accRef.current >= 1 / fps) {
                    accRef.current = 0;
                    push(t);
                }
            }
            setPlayheadSec(t);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [sync.source, sync.signal, isPlaying, push]);

    // --- Transport API ------------------------------------------------------
    const seek = useCallback((t) => {
        const clamped = Math.max(0, t);
        playheadRef.current = clamped;
        setPlayheadSec(clamped);
        accRef.current = 0;
    }, []);

    const play = useCallback(() => {
        const end = getTimelineDuration(stateRef.current);
        const external = stateRef.current.settings.sync?.source !== 'internal';
        // Internal transport restarts from the top when parked at the end;
        // an external show clock always knows where it is, so never rewind.
        if (!external && playheadRef.current >= end) seek(0);
        isPlayingRef.current = true;
        setIsPlaying(true);
    }, [seek]);

    const pause = useCallback(() => {
        isPlayingRef.current = false;
        setIsPlaying(false);
    }, []);

    const stop = useCallback(() => {
        isPlayingRef.current = false;
        setIsPlaying(false);
        playheadRef.current = 0;
        setPlayheadSec(0);
        accRef.current = 0;
        // Blank everything this engine has been feeding.
        if (window.electronAPI) window.electronAPI.send('dac-frame-update', {});
    }, []);

    // Master output switch: flips the laser on/off independently of the
    // transport. Turning it off blanks the DAC immediately; turning it on
    // re-enables output for the next / in-flight push cycle.
    const setLaserOn = useCallback(async (on) => {
        laserOnRef.current = !!on;
        setLaserOnState(!!on);

        const api = window.electronAPI;
        if (!api) return;

        const dacs = getDacIps();
        if (on) {
            // Start the main-process 30fps send loop (idempotent).
            api.send('start-dac-send-loop');
            // Open wired connections + clear the stopped-DAC set so the
            // accumulator doesn't drop our frames.
            for (const [ip, type] of dacs) {
                try { await api.startDacOutput(ip, type); } catch (_) {}
            }
        } else {
            // Cleanly blank + close each DAC we were feeding.
            for (const [ip, type] of dacs) {
                try { await api.stopDacOutput(ip, type); } catch (_) {}
            }
            api.send('stop-dac-send-loop');
        }
    }, [getDacIps]);

    // Clean up on unmount (e.g. navigating away from the Timeline page).
    useEffect(() => {
        return () => {
            if (!laserOnRef.current || !window.electronAPI) return;
            const dacs = getDacIps();
            for (const [ip, type] of dacs) {
                try { window.electronAPI.stopDacOutput(ip, type); } catch (_) {}
            }
            window.electronAPI.send('stop-dac-send-loop');
        };
    }, [getDacIps]);

    // Live preview: compile just the given channel at `t` (no DAC send). The
    // editor's preview canvas calls this every animation frame.
    const previewFrame = useCallback((channelId, t) => compileChannelFrame(channelId, t), [compileChannelFrame]);

    return { isPlaying, playheadSec, laserOn, setLaserOn, play, pause, stop, seek, sync, previewFrame };
}