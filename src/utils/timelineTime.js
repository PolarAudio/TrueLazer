/**
 * Pure time↔pixel / ruler / snapping / timecode helpers for the Timeline
 * window. Kept dependency-free and DOM-free so it is trivially unit-testable.
 *
 * Time is always measured in absolute seconds. The horizontal zoom factor is
 * `pxPerSecond` (seconds-per-pixel inverted), i.e. how many screen pixels one
 * second of timeline occupies.
 */

export const SNAP_MODES = ['off', 'frame', 'beat', 'eighth', 'sixteenth'];

export const DEFAULT_TIMESIGNATURE = Object.freeze({ beats: 4, unit: 4 });

/** Duration, in seconds, of one beat (quarter note) at `bpm`. */
export function beatDuration(bpm) {
    const safe = Number(bpm) > 0 ? Number(bpm) : 120;
    return 60 / safe;
}

/** Return the snapping interval in seconds for a given snap mode. 0 = off. */
export function snapInterval(snapMode, { bpm = 120, fps = 30 } = {}) {
    if (snapMode === 'off' || !snapMode) return 0;
    if (snapMode === 'frame') return 1 / Math.max(1, Number(fps) || 30);
    const beat = beatDuration(bpm);
    if (snapMode === 'beat') return beat;
    if (snapMode === 'eighth') return beat / 2;
    if (snapMode === 'sixteenth') return beat / 4;
    return 0;
}

/** Round a time (seconds) to the current snapping grid. Returns input when off. */
export function snapToGrid(time, snapMode, opts = {}) {
    const interval = snapInterval(snapMode, opts);
    if (!interval) return time;
    if (!isFinite(time)) return time;
    return Math.round(time / interval) * interval;
}

/** Snap a duration while guaranteeing a small positive floor (no zero-width blocks). */
export function snapDuration(startTime, endTime, snapMode, { minDuration = 0.1, ...opts } = {}) {
    const snappedStart = snapToGrid(startTime, snapMode, opts);
    const snappedEnd = snapToGrid(endTime, snapMode, opts);
    const duration = Math.max(minDuration, Math.round((snappedEnd - snappedStart) * 1000) / 1000);
    return { startTime: snappedStart, duration };
}

export const timeToPx = (time, pxPerSecond) => time * pxPerSecond;
export const pxToTime = (px, pxPerSecond) => (pxPerSecond > 0 ? px / pxPerSecond : 0);

const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** Standard (non-drop) SMPTE-style timecode HH:MM:SS:FF at `fps`. */
export function formatTimecode(seconds, fps = 30) {
    const safe = Math.max(0, seconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = Math.floor(safe % 60);
    const frames = Math.floor((safe % 1) * fps);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(frames)}`;
}

/** Compact clock label: `mm:ss` (with hours only when >= 1h). */
export function formatClock(seconds) {
    const safe = Math.max(0, seconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = Math.floor(safe % 60);
    if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(m)}:${pad2(s)}`;
}

/** Human duration for the inspector, e.g. "2.500 s" / "1:30.0". */
export function formatDuration(seconds) {
    const safe = Math.max(0, seconds);
    if (safe >= 60) {
        const m = Math.floor(safe / 60);
        const s = safe - m * 60;
        return `${m}:${s.toFixed(3).padStart(6, '0')}`;
    }
    return `${safe.toFixed(3)} s`;
}

// Nice descending time steps (seconds) so tick labels never crowd.
const NICE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Pick a "nice" tick step (seconds) so ticks stay at least `minPx` apart. */
export function getTickStep(pxPerSecond, { minPx = 90 } = {}) {
    const raw = minPx / Math.max(1e-6, pxPerSecond || 1);
    for (const step of NICE_STEPS) {
        if (step >= raw) return step;
    }
    return 3600;
}

/**
 * Generate ruler ticks for the visible range.
 * Returns `{ step, ticks }` where each tick = `{ time, label }`.
 */
export function rulerTicks(startTime, duration, pxPerSecond, { minPx = 90, fps = 30 } = {}) {
    const step = getTickStep(pxPerSecond, { minPx });
    const endTime = startTime + Math.max(0, duration);
    const first = Math.floor(startTime / step) * step;
    const ticks = [];
    const useHms = step >= 60;
    for (let t = first; t <= endTime + step * 0.5; t += step) {
        const rounded = Math.round(t * 10000) / 10000;
        if (rounded < startTime - 1e-6) continue;
        ticks.push({
            time: rounded,
            label: useHms ? formatClock(rounded) : rounded.toFixed(step < 1 ? 2 : 0),
            frame: Math.floor((rounded % 1) * fps),
        });
    }
    return { step, ticks };
}

/**
 * Beat grid lines for the visible range (multiples of a beat, given a time
 * signature). Each line = `{ time, bar, beatInBar }`, 1-indexed `bar`.
 */
export function beatGridLines(startTime, duration, { bpm = 120, timeSignature = DEFAULT_TIMESIGNATURE } = {}) {
    const beat = beatDuration(bpm);
    const beatsPerBar = Math.max(1, timeSignature?.beats || 4);
    const barDuration = beatsPerBar * beat;
    const endTime = startTime + Math.max(0, duration);
    const lines = [];
    const firstBar = Math.floor(startTime / barDuration);
    for (let bar = firstBar, t = firstBar * barDuration; t <= endTime + beat * 0.5; t += beat) {
        const rounded = Math.round(t * 10000) / 10000;
        if (rounded < startTime - 1e-6) {
            continue;
        }
        const barIndex = Math.floor(rounded / barDuration);
        const beatInBar = Math.round((rounded - barIndex * barDuration) / beat) % beatsPerBar;
        lines.push({
            time: rounded,
            bar: barIndex + 1,
            beatInBar,
            isBarStart: rounded - barIndex * barDuration < 1e-6,
        });
    }
    return lines;
}

/** pxPerSecond for a timeline whose total `duration` fills `width` (fit-to-window). */
export function zoomForDuration(duration, width) {
    return width > 0 && duration > 0 ? width / duration : 50;
}

/** Clamp a pxPerSecond zoom into a sane band (e.g. wheel zoom steps). */
export function clampZoom(pxPerSecond, { min = 5, max = 2000 } = {}) {
    return Math.max(min, Math.min(max, pxPerSecond));
}

export const DEFAULT_ZOOM = 50;