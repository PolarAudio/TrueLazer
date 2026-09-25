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
function decimatePoints(points, maxPoints) {
    const n = countPoints(points);
    const target = Math.max(1, maxPoints | 0);
    if (points == null || n === 0 || n <= target) return points;

    const out = new Float32Array(target * 8);
    for (let i = 0; i < target; i++) {
        const src = Math.round((i * (n - 1)) / (target - 1));
        const so = src * 8;
        const doff = i * 8;
        if (points instanceof Float32Array || Buffer.isBuffer(points) || points instanceof Uint8Array) {
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
    // Preserve the end-of-frame marker on the last decimated point.
    out[(target - 1) * 8 + 7] = 1;
    return out;
}

module.exports = {
    MIN_PPS,
    MAX_PPS,
    clamp,
    countPoints,
    computePointBudget,
    decimatePoints,
};