// dac-budget.cjs
// Shared point-budget helpers for the DAC send path.
//
// pointBudget = targetPps / targetFps is the single source of truth (mirrors
// src/utils/speedTarget.js) for how many points the wire may carry per frame.
// The renderer's optimizer is free to produce as many points as it likes; this
// module lets each DAC backend evenly decimate an oversized frame down to the
// budget so the DMA never overruns its frame window — the cause of the
// "constant-PPS fill runs out of points" lag on complex clips.

const { Buffer } = require('buffer');

const MIN_PPS = 1000;
const MAX_PPS = 120000;

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

// Count points in any supported container:
//   Float32Array      -> 8 floats per point
//   Buffer/Uint8Array -> 8 bytes per point
//   Array             -> 1 element per point
function countPoints(points) {
    if (!points) return 0;
    if (points instanceof Float32Array || Buffer.isBuffer(points) || points instanceof Uint8Array) {
        return Math.floor(points.length / 8);
    }
    if (Array.isArray(points)) return points.length;
    return 0;
}

// Per-frame point budget for a PPS/FPS pairing, optionally capped (e.g. a
// hardware single-chunk limit). Always >= 1.
function computePointBudget({ targetPps = 30000, targetFps = 30, cap = 0 }) {
    const fps = clamp(targetFps > 0 ? targetFps : 30, 1, 360);
    const pps = clamp(targetPps > 0 ? targetPps : 30000, MIN_PPS, MAX_PPS);
    const budget = Math.max(1, Math.round(pps / fps));
    return cap > 0 ? Math.min(budget, cap) : budget;
}

// Evenly decimate a frame to `maxPoints` points. Returns the original reference
// when already in budget (never unnecessarily copies); otherwise a NEW
// Float32Array so the renderer's shared buffer is never mutated. First and last
// source points are preserved (the last carries the end-of-frame marker).
//
// Blanking-aware: uniform index sampling alone would step straight over a short
// blanked run — a safety zone spanning only a handful of samples of a 1000-point
// frame could be dropped entirely, so the zone would exist in the preview and
// do nothing on the laser. Every point on a blank<->lit boundary is therefore
// forced into the output, and the remaining budget is spent sampling the long
// lit runs. When the forced points alone meet or exceed the budget they are
// emitted verbatim, capped at `target` so the DMA window is still respected.
function decimatePoints(points, maxPoints) {
    const n = countPoints(points);
    const target = Math.max(1, maxPoints | 0);
    if (points == null || n === 0 || n <= target) return points;

    const isTyped = points instanceof Float32Array || Buffer.isBuffer(points) || points instanceof Uint8Array;
    const blankAt = (i) => (isTyped ? points[i * 8 + 6] > 0.5 : !!(points[i] && points[i].blanking));

    // Indices that must survive: the frame ends, plus every blanked run in full
    // together with the lit points on either side of it.
    //
    // Forcing the whole run (not just its edges) is essential: a zone is a
    // region that must stay dark, so sampling into the middle of a short run
    // would re-light the beam inside the safety area. The neighbouring lit
    // points are kept so the transition itself is represented and the beam is
    // commanded off before it enters the run.
    const forced = new Uint8Array(n);
    let forcedCount = 0;
    const force = (i) => {
        if (i >= 0 && i < n && !forced[i]) { forced[i] = 1; forcedCount++; }
    };
    force(0);
    force(n - 1);
    let i = 0;
    while (i < n) {
        if (!blankAt(i)) { i++; continue; }
        let e = i;
        while (e + 1 < n && blankAt(e + 1)) e++; // end of this blanked run
        force(i - 1);
        for (let k = i; k <= e; k++) force(k);
        force(e + 1);
        i = e + 1;
    }

    if (forcedCount >= target) {
        // Too many transitions to fit: emit the forced points in order. The
        // caller already sized the buffer for `target` points, so this can
        // overrun — hence the hard stop below.
        const keep = Math.min(target, forcedCount);
        const out = new Float32Array(keep * 8);
        let w = 0;
        for (let i = 0; i < n && w < keep; i++) {
            if (forced[i]) { copyPoint(points, out, i, w, isTyped); w++; }
        }
        out[(w - 1) * 8 + 7] = 1;
        return out;
    }

    // Distribute the leftover budget over the lit runs, stepping uniformly
    // inside each run so a long stroke keeps its shape.
    const litBudget = target - forcedCount;
    const litIdx = [];
    for (let i = 0; i < n; i++) if (!forced[i]) litIdx.push(i);

    const picked = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (forced[i]) picked[i] = 1;
    const litCount = litIdx.length;
    const take = Math.min(litBudget, litCount);
    for (let j = 0; j < take; j++) {
        const idx = litIdx[Math.floor((j * litCount) / take)];
        picked[idx] = 1;
    }

    const out = new Float32Array(target * 8);
    let w = 0;
    for (let i = 0; i < n && w < target; i++) {
        if (picked[i]) { copyPoint(points, out, i, w, isTyped); w++; }
    }
    // Preserve the end-of-frame marker on the last decimated point.
    out[(w - 1) * 8 + 7] = 1;
    return out;
}

// Copy point `src` from any supported container into `out` at slot `dst`.
function copyPoint(points, out, src, dst, isTyped) {
    const so = src * 8;
    const doff = dst * 8;
    if (isTyped) {
        for (let k = 0; k < 8; k++) out[doff + k] = points[so + k];
    } else {
        const p = points[src];
        out[doff] = p.x || 0;
        out[doff + 1] = p.y || 0;
        out[doff + 2] = 0;
        out[doff + 3] = p.r || 0;
        out[doff + 4] = p.g || 0;
        out[doff + 5] = p.b || 0;
        out[doff + 6] = p.blanking ? 1 : 0;
        out[doff + 7] = 0;
    }
}

module.exports = {
    MIN_PPS,
    MAX_PPS,
    clamp,
    countPoints,
    computePointBudget,
    decimatePoints,
};