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
    const b = new Float32Array(8);
    b[6] = 1;
    b[7] = 1;
    return b;
}

/**
 * Pick the winning cue among `cues` at timeline time `t`. Ignores cues that
 * haven't started or already finished (unless looping). Higher layerPriority
 * wins; ties go to the cue that started most recently.
 */
export function selectActiveCue(cues, t) {
    const active = (cues || [])
        .filter(Boolean)
        .map((c) => ({ c, rel: t - c.startTime }))
        .filter(({ c, rel }) => rel >= -1e-6 && (c.isLooping || rel < c.duration));
    if (active.length === 0) return null;
    active.sort((a, b) => {
        const prio = (b.c.layerPriority || 0) - (a.c.layerPriority || 0);
        if (prio !== 0) return prio;
        return b.c.startTime - a.c.startTime;
    });
    return active[0].c;
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