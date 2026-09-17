import { useCallback, useEffect, useRef, useState } from 'react';
import { useTimeline, getTimelineDuration, getChannelOutputs, isChannelAudible } from '../contexts/TimelineContext';
import { useIldaParserWorker } from '../contexts/IldaParserWorkerContext';
import { useAudio } from '../contexts/AudioContext.jsx';
import { applyLanesToPoints } from '../utils/timelineAutomation';
import { selectActiveCue, buildGeneratorFrame, blankFrame } from '../utils/timelineCompile';
import { useTimelineSync } from './useTimelineSync';

/**
 * Transport + compile-to-DAC engine for the Timeline window.
 *
 * Clock: rAF while playing advances a wall-clock playhead (loop-aware). When a
 * timeline audio track is loaded the element follows the playhead (drift
 * corrected), never the other way around — the transport always advances.
 * When an external sync source is selected the playhead follows its signal
 * (also while paused), falling back to the wall clock during playback while no
 * signal is arriving so Play never freezes the head.
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
    const { audioCtx, connectMediaElement, globalVolume, selectedDeviceId } = useAudio();

    const [isPlaying, setIsPlaying] = useState(false);
    const [playheadSec, setPlayheadSec] = useState(0);
    const [laserOn, setLaserOnState] = useState(false);

    const stateRef = useRef(state);
    stateRef.current = state;

    const playheadRef = useRef(0);
    // Replay anchor: the last place the playhead was parked while stopped.
    // Spacebar/play starts from here and pause returns the head to it.
    const anchorRef = useRef(0);
    const accRef = useRef(0);
    const laserOnRef = useRef(false);
    const isPlayingRef = useRef(false);
    const syncRef = useRef(sync);
    syncRef.current = sync;

    // Timeline audio track: an <audio> element mirroring the transport so the
    // show plays locked to the loaded track.
    const audioRef = useRef(null); // HTMLAudioElement (or null)
    const audioClockRef = useRef(false); // don't let the wall clock fight audio
    const audioSrcConnectedRef = useRef(false);

    // (Re)build the timeline audio element when the track path changes.
    const audioPath = state.settings?.audio?.path || null;
    useEffect(() => {
        const old = audioRef.current;
        if (old) {
            try { old.pause(); } catch (_) {}
            audioRef.current = null;
        }
        audioSrcConnectedRef.current = false;
        if (!audioPath) return;

        let el;
        try {
            el = new Audio(`file:///${audioPath}`);
            el.preload = 'auto';
        } catch (e) {
            console.warn('Timeline audio create failed:', e);
            return;
        }
        audioRef.current = el;
        return () => {
            try { el.pause(); } catch (_) {}
            audioRef.current = null;
        };
    }, [audioPath]);

    // Route the track through the analyser + destination once the AudioContext
    // exists (it is created on the first user gesture), so FFT/LTC sync and the
    // app output both see the music. The element itself is never rebuilt here —
    // only the media-source graph node is attached once. Windows Electron
    // creates the context suspended on the first gesture and resumes it async,
    // so the effect re-arms on the state transition to 'running' too.
    useEffect(() => {
        const el = audioRef.current;
        if (!el || !audioCtx || audioCtx.state !== 'running') return;
        if (audioSrcConnectedRef.current) return;
        try {
            connectMediaElement(el);
            audioSrcConnectedRef.current = true;
        } catch (e) {
            console.warn('Timeline audio route failed:', e);
        }
    }, [audioPath, audioCtx, audioCtx?.state, connectMediaElement]);

    // Keep volume + sink in step with the app-wide audio settings.
    useEffect(() => {
        const el = audioRef.current;
        if (el) el.volume = globalVolume || 1;
    }, [globalVolume, audioPath]);

    useEffect(() => {
        const el = audioRef.current;
        if (el && selectedDeviceId && el.setSinkId) {
            el.setSinkId(selectedDeviceId).catch(() => {});
        }
    }, [selectedDeviceId, audioPath]);

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
    // Internal: the rAF wall clock owns the playhead, so it always advances
    // while playing even if the timeline audio element stalls or is paused. The
    // track's own clock is re-seeked to the playhead each frame it drifts —
    // audio follows the transport, it never owns it. External: while a signal
    // is present the playhead tracks the sync source (with sub-frame
    // extrapolation between updates), even when paused — so the ruler/preview
    // always reflects the show clock. If an external source is selected but no
    // signal is arriving yet, the wall clock keeps the transport running while
    // playing (the head snaps to the show clock the moment a signal appears).
    // Pushes stay gated on play + laser.
    useEffect(() => {
        const external = sync.source !== 'internal';
        const following = external && sync.signal;
        const active = isPlaying || following;
        if (!active) return;
        let raf;
        let last = performance.now();
        const tick = (now) => {
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            let t;
            if (following) {
                // Jump to the latest external sample, extrapolate past it.
                t = syncRef.current.seconds + Math.min(0.5, (now - syncRef.current.lastUpdate) / 1000);
            } else {
                // Wall-clock master: the playhead always advances on rAF time,
                // so a stalled/paused audio element can never freeze the show.
                // The timeline track is re-seeked to the playhead when its own
                // clock drifts, keeping audio and show locked together without
                // letting the media element own the transport.
                t = playheadRef.current + dt;
                const el = audioRef.current;
                if (el && audioClockRef.current && !el.paused
                    && el.readyState >= 1 && isFinite(el.duration)) {
                    const drift = el.currentTime - t;
                    if (Math.abs(drift) >= 0.2) {
                        try { el.currentTime = Math.min(el.duration, Math.max(0, t)); } catch (_) {}
                    }
                }
                const s = stateRef.current.settings;
                const end = getTimelineDuration(stateRef.current);
                const loop = s.loopEnabled && s.loop && s.loop.end > s.loop.start
                    ? s.loop
                    : null;
                if (loop) {
                    const span = loop.end - loop.start;
                    if (t >= loop.end) {
                        t = loop.start + ((t - loop.start) % span);
                        // Keep the audio element inside the loop too.
                        if (el && el.currentTime > loop.end) {
                            try { el.currentTime = t; } catch (_) {}
                        }
                    }
                    if (t < loop.start) {
                        t = loop.end - ((loop.start - t) % span);
                        if (el && el.currentTime < loop.start) {
                            try { el.currentTime = t; } catch (_) {}
                        }
                    }
                } else if (t >= end) {
                    playheadRef.current = end;
                    setPlayheadSec(end);
                    setIsPlaying(false);
                    const audioEl = audioRef.current;
                    if (audioEl) { try { audioEl.pause(); } catch (_) {} }
                    audioClockRef.current = false;
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
        // Parking the head while stopped establishes the replay anchor;
        // moving it mid-playback never moves the anchor.
        if (!isPlayingRef.current) anchorRef.current = clamped;
        const el = audioRef.current;
        if (el && el.readyState >= 1 && isFinite(el.duration)) {
            try { el.currentTime = Math.min(clamped, el.duration); } catch (_) {}
        }
    }, []);

    const play = useCallback(() => {
        const end = getTimelineDuration(stateRef.current);
        const external = stateRef.current.settings.sync?.source !== 'internal';
        const following = external && syncRef.current.signal;
        // Parked at the end (seek or auto-stop): replay from the anchor, not
        // the timeline start. A live show clock always knows where it is, so
        // never rewind it.
        if (!following && playheadRef.current >= end) seek(anchorRef.current);
        isPlayingRef.current = true;
        setIsPlaying(true);

        // Start (or restart) the timeline audio from the playhead. The rAF
        // wall clock owns the transport, so a slow/stalled element can't stall
        // playback — it's only re-seeked when it drifts.
        const el = audioRef.current;
        if (el) {
            audioClockRef.current = true;
            if (audioCtx) {
                if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
                // Route once the context is available and running (created on
                // the first user gesture, which this play usually is).
                if (!audioSrcConnectedRef.current && audioCtx.state !== 'suspended') {
                    try {
                        connectMediaElement(el);
                        audioSrcConnectedRef.current = true;
                    } catch (_) {}
                }
            }
            if (el.readyState >= 1 && isFinite(el.duration)) {
                try { el.currentTime = Math.min(playheadRef.current, el.duration); } catch (_) {}
            }
            const p = el.play();
            if (p) p.catch((err) => {
                console.warn('Timeline audio play failed:', err);
                audioClockRef.current = false;
            });
        }
    }, [seek, audioCtx, connectMediaElement]);

    const pause = useCallback(() => {
        isPlayingRef.current = false;
        setIsPlaying(false);
        const el = audioRef.current;
        if (el) { el.pause(); }
        audioClockRef.current = false;
        // Replay anchor: pause returns the playhead to the last position it was
        // parked at, so play/pause always resumes from the same spot (and
        // seeking there also snaps the timeline audio back).
        seek(anchorRef.current);
    }, [seek]);

    const stop = useCallback(() => {
        isPlayingRef.current = false;
        setIsPlaying(false);
        playheadRef.current = 0;
        setPlayheadSec(0);
        accRef.current = 0;
        audioClockRef.current = false;
        const el = audioRef.current;
        if (el) {
            el.pause();
            try { el.currentTime = 0; } catch (_) {}
        }
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
            const audioEl = audioRef.current;
            if (audioEl) {
                try { audioEl.pause(); } catch (_) {}
                audioClockRef.current = false;
            }
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

    return { isPlaying, playheadSec, laserOn, setLaserOn, play, pause, stop, seek, sync, previewFrame, anchor: anchorRef.current };
}