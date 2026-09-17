import { useCallback, useEffect, useRef, useState } from 'react';
import { useTimeline } from '../contexts/TimelineContext';
import { useMidi } from '../contexts/MidiContext';
import { useAudio } from '../contexts/AudioContext';
import { initializeMidi, getMidiInputs, listenToRawMidiBytes } from '../utils/midi';
import {
    MtcQuarterFrameDecoder,
    MidiClockTracker,
    LtcBiphaseDecoder,
    decodeMtcFullFrame,
    timecodeToSeconds,
} from '../utils/timecodeSync';

const MTC_RATE_FPS = [24, 25, 29.97, 30];
const SIGNAL_TIMEOUT_MS = 1500;

/**
 * Resolve which MIDI input the sync decoders should listen to.
 * Priority: an explicitly chosen sync device → the Windows GS wavetable
 * synthesizer by name (common MTC/Clock source) → the globally selected MIDI
 * input → the first available device.
 */
export function resolveMidiSyncDevice(inputDeviceId, inputs, globalSelectedId = '') {
    if (inputDeviceId && inputs.some((i) => i.id === inputDeviceId)) return inputDeviceId;
    const gs = inputs.find((i) => /gs wavetable|microsoft gs/i.test(`${i.name}`));
    if (gs) return gs.id;
    if (globalSelectedId && inputs.some((i) => i.id === globalSelectedId)) return globalSelectedId;
    return inputs.length ? inputs[0].id : null;
}

/**
 * Decodes all four external timecode sources simultaneously and reports the one
 * selected in timeline settings (`settings.sync.source`):
 *
 *   internal   wall-clock (no external sync)
 *   mtc        MIDI Time Code quarter frames + full-frame SysEx
 *   midiClock  MIDI Clock / Song Position Pointer (tempo-based)
 *   ltc        LTC audio (biphase-mark) read off the analyser
 *   artnet     Art-Net TimeCode packets (UDP 6454 via main process)
 *
 * Returns `{ source, running, seconds, timecode, rate, signal, lastUpdate }`.
 * `rate` is fps for frame codecs (mtc/ltc/artnet) or BPM for midiClock.
 * MIDI sources additionally return `devices` (discovered inputs), `deviceId`
 * (the input actually bound) and `midi` (diagnostics: bytes seen + last hex).
 */
export const useTimelineSync = () => {
    const { state } = useTimeline();
    const { midiInitialized, midiInputs, selectedMidiInputId } = useMidi();
    const { audioCtx, analyser } = useAudio();

    const cfg = state.settings.sync || { source: 'internal', fps: 30, artnetUniverse: 0, inputDeviceId: '' };
    const source = cfg.source;
    // MIDI devices are only relevant to the MTC / MIDI Clock sources.
    const wantMidi = source === 'mtc' || source === 'midiClock';

    const [sync, setSync] = useState({
        source,
        running: false,
        seconds: 0,
        timecode: null,
        rate: cfg.fps || 30,
        signal: false,
        lastUpdate: 0,
    });
    const [localMidi, setLocalMidi] = useState({ ready: false, inputs: [] });
    const [midiDiag, setMidiDiag] = useState({ count: 0, lastHex: '' });

    // Latest values for listeners that bind once.
    const sourceRef = useRef(source);
    sourceRef.current = source;
    const cfgRef = useRef(cfg);
    cfgRef.current = cfg;

    const midiDecodersRef = useRef(null);
    if (!midiDecodersRef.current) {
        midiDecodersRef.current = {
            mtc: new MtcQuarterFrameDecoder(),
            clock: new MidiClockTracker(120),
        };
    }
    const ltcRef = useRef(null);
    const stopWatchRef = useRef(null);
    const lastPublishRef = useRef(0);
    const midiDiagRef = useRef({ count: 0, lastHex: '' });
    const PUBLISH_MS = 50;

    // Self-enable WebMidi for timecode even when the app's MIDI-shortcut toggle
    // is off — otherwise MidiProvider never initializes WebMidi and the raw
    // listen (and the device list) stay empty.
    useEffect(() => {
        if (!wantMidi) {
            setLocalMidi({ ready: false, inputs: [] });
            return;
        }
        let mounted = true;
        initializeMidi()
            .then(() => {
                if (!mounted) return;
                setLocalMidi({ ready: true, inputs: getMidiInputs() });
            })
            .catch((err) => {
                console.warn('Timeline sync: MIDI init failed:', err?.message || err);
                if (mounted) setLocalMidi({ ready: false, inputs: [] });
            });
        return () => { mounted = false; };
    }, [wantMidi]);

    const allInputs = (midiInputs && midiInputs.length ? midiInputs : localMidi.inputs) || [];
    const midiReady = midiInitialized || localMidi.ready;
    const midiInputId = wantMidi ? resolveMidiSyncDevice(cfg.inputDeviceId, allInputs, selectedMidiInputId) : null;

    /**
     * Publish a decoded sample. Arms a watchdog that drops running when a
     * source stops sending for SIGNAL_TIMEOUT_MS. React state is throttled so a
     * hot 24 PPQN clock stream never forces 100+ re-renders/s.
     */
    const report = useCallback((patch) => {
        const stopWatch = () => {
            if (stopWatchRef.current) {
                clearTimeout(stopWatchRef.current);
                stopWatchRef.current = null;
            }
        };
        const running = patch.running === undefined ? true : patch.running;
        stopWatch();
        if (running) {
            stopWatchRef.current = setTimeout(() => {
                setSync((prev) => (prev.signal ? { ...prev, running: false, signal: false } : prev));
                stopWatchRef.current = null;
            }, SIGNAL_TIMEOUT_MS);
        }
        const now = performance.now();
        const sample = { ...patch, running, signal: true, lastUpdate: now };
        if (now - lastPublishRef.current >= PUBLISH_MS) {
            lastPublishRef.current = now;
            setSync((prev) => ({ ...prev, ...sample }));
        }
    }, []);

    /* -------- MIDI: MTC + MIDI Clock share the raw byte stream ------------ */
    useEffect(() => {
        if (!midiReady || !midiInputId) return;
        const dec = midiDecodersRef.current;
        return listenToRawMidiBytes(midiInputId, (bytes) => {
            // Diagnostics: always track bytes (throttled to the status readout).
            const diag = midiDiagRef.current;
            diag.count++;
            diag.lastHex = bytes.slice(0, 8).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            if (performance.now() - lastPublishRef.current >= PUBLISH_MS) {
                lastPublishRef.current = performance.now();
                setMidiDiag({ count: diag.count, lastHex: diag.lastHex });
            }

            if (sourceRef.current === 'internal') return;

            if (sourceRef.current === 'mtc') {
                const quarter = dec.mtc.push(bytes);
                const full = decodeMtcFullFrame(bytes);
                const timecode = quarter || full;
                if (timecode) {
                    const rate = full ? (MTC_RATE_FPS[full.rate] || 30) : (cfgRef.current.fps || 30);
                    report({ timecode, rate, seconds: timecodeToSeconds(timecode, rate) });
                }
                return;
            }

            if (sourceRef.current === 'midiClock') {
                const snap = dec.clock.push(bytes);
                report({ running: snap.running, seconds: snap.seconds, timecode: null, rate: dec.clock.bpm });
            }
        });
    }, [midiReady, midiInputId, report]);

    /* -------- LTC: read the analyser, decode biphase-mark ----------------- */
    useEffect(() => {
        if (!analyser || source !== 'ltc') return;
        const desiredFps = cfg.fps || 30;
        const sampleRate = (audioCtx && audioCtx.sampleRate) || 48000;
        if (!ltcRef.current || ltcRef.current.fps !== desiredFps || ltcRef.current.sampleRate !== sampleRate) {
            ltcRef.current = new LtcBiphaseDecoder({ fps: desiredFps, sampleRate });
        }
        const buf = new Float32Array(analyser.fftSize);
        let raf;
        const tick = () => {
            analyser.getFloatTimeDomainData(buf);
            const tc = ltcRef.current.push(buf);
            if (tc && sourceRef.current === 'ltc') {
                const fps = cfgRef.current.fps || 30;
                report({ timecode: tc, rate: fps, seconds: timecodeToSeconds(tc, fps) });
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [analyser, audioCtx && audioCtx.sampleRate, source, cfg.fps, report]);

    /* -------- Art-Net TimeCode over UDP 6454 ------------------------------ */
    useEffect(() => {
        if (window.electronAPI && source === 'artnet') {
            window.electronAPI.startArtnetTimecodeListener();
        }
        if (!window.electronAPI || source !== 'artnet') return;
        const off = window.electronAPI.onArtnetTimecode((tc) => {
            if (sourceRef.current !== 'artnet') return;
            const rate = MTC_RATE_FPS[tc.type] || (cfgRef.current.fps || 30);
            report({
                timecode: { hours: tc.hours, minutes: tc.minutes, seconds: tc.seconds, frames: tc.frames },
                rate,
                seconds: timecodeToSeconds(tc, rate),
            });
        });
        return () => {
            off();
            if (window.electronAPI) window.electronAPI.stopArtnetTimecodeListener();
        };
    }, [source, report]);

    /* -------- source switch: reset idle state ----------------------------- */
    useEffect(() => {
        setSync((prev) => {
            if (prev.source === source && (source === 'internal' ? !prev.running : true)) return prev;
            return {
                source,
                running: false,
                signal: false,
                seconds: prev.seconds,
                timecode: prev.timecode,
                rate: cfg.fps || 30,
                lastUpdate: 0,
            };
        });
    }, [source, cfg.fps]);

    return {
        ...sync,
        devices: allInputs,
        deviceId: midiInputId,
        midi: midiDiag,
    };
};