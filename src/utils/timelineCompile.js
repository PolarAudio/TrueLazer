/**
 * Pure compile helpers for the Timeline playback engine. No DOM / React.
 *
 * "Canonical frame" = Float32Array of 8 floats per point:
 *   [x, y, z, r, g, b, blanking(0|1), lastPoint(0|1)]
 */
import { generateCircle, generateSquare, generateTriangle, generateLine, generateStar, generateSinewave } from './generators';

export const SYNC_GENERATORS = {
    circle: generateCircle,
    square: generateSquare,
    triangle: generateTriangle,
    line: generateLine,
    star: generateStar,
    sinewave: generateSinewave,
};

/** Convert generator object points to the canonical 8-float stamped frame. */
export function toFlat8(objPoints) {
    const n = objPoints.length;
    const out = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
        const p = objPoints[i];
        const o = i * 8;
        out[o] = p.x;
        out[o + 1] = p.y;
        out[o + 2] = p.z || 0;
        out[o + 3] = p.r;
        out[o + 4] = p.g;
        out[o + 5] = p.b;
        out[o + 6] = p.blanking ? 1 : 0;
        out[o + 7] = p.lastPoint ? 1 : 0;
    }
    out[(n - 1) * 8 + 7] = 1;
    return out;
}

/** A single blacked / blanked point — used for blackout and idle frames. */
export function blankFrame() {
    // A discrete IDN frame must contain either 0 or at least 2 samples; a
    // single-sample frame is rejected by strict players, which then keep the
    // last real frame on screen. Two blanked points read as fully off.
    const b = new Float32Array(16);
    b[6] = 1;  // point 0: blanking
    b[14] = 1; // point 1: blanking
    b[15] = 1; // point 1: last point
    return b;
}

/**
 * Every cue active at timeline time `t`, ordered background → foreground:
 * lowest layerPriority first, highest last (the merge order). Ties on
 * layerPriority keep the most recently started cue last, so the last entry is
 * always the winner `selectActiveCue` would pick.
 */
export function getActiveCues(cues, t) {
    const active = (cues || [])
        .filter(Boolean)
        .filter((c) => !c.muted)
        .map((c) => ({ c, rel: t - c.startTime }))
        .filter(({ c, rel }) => rel >= -1e-6 && (c.isLooping || rel < c.duration));
    return active.sort((a, b) => {
        const pa = a.c.layerPriority || 0;
        const pb = b.c.layerPriority || 0;
        if (pa !== pb) return pa - pb;
        return (a.c.startTime || 0) - (b.c.startTime || 0);
    });
}

/**
 * Pick the winning cue among `cues` at timeline time `t`. Ignores cues that
 * haven't started or already finished (unless looping). Higher layerPriority
 * wins; ties go to the cue that started most recently.
 */
export function selectActiveCue(cues, t) {
    const active = getActiveCues(cues, t);
    const top = active[active.length - 1];
    return top ? top.c : null;
}

/**
 * Build the canonical typed frame for a GENERATOR cue by running its shape
 * generator synchronously with the cue's params. Returns null for unknown /
 * async-only generator ids.
 */
export function buildGeneratorFrame(cue) {
    const gen = SYNC_GENERATORS[cue.generatorId];
    if (!gen) return null;
    try {
        const res = gen(cue.generatorParams || {});
        const pts = res && res.points ? res.points : res;
        if (!pts || typeof pts.length !== 'number' || pts.length === 0) return null;
        if (pts instanceof Float32Array) return pts;
        return toFlat8(pts);
    } catch (e) {
        return null;
    }
}