// layerMerge.js
// Per-channel frame composition engine matching the layer-merge model:
//
//   OFF               (priority) : one winning clip per channel, chosen by
//                                   z-order priority (lowest layerIndex wins).
//   ON + Overlay OFF  (combine)  : concatenate ALL clips sequentially with
//                                   blanking transitions. No geometry cutting.
//   ON + Overlay ON   (overlay)  : composite every clip on the channel; strokes
//                                   of lower-priority (higher layerIndex) layers
//                                   that land on top of a higher-priority layer's
//                                   lit stroke are culled (cut), then blend
//                                   (normal/add/subtract) is applied to the
//                                   surviving overlapping region.
//
// Point-budget enforcement (shape-preserving reduction) happens HERE, at the
// merge step, before the shaped frame reaches the DAC path. The DAC-side
// optimizer is intended to be only a display polisher, not a budget arbiter.
//
// 8-float layout: x,y,z,r,g,b,blanking(0/1),lastPoint(0/1)

import reduceFramePoints, { computeLitSegments } from './pointReducer.js';

export const BLEND = {
  NORMAL: 'normal',
  ADD: 'add',
  SUBTRACT: 'subtract',
};

export const MERGE_MODE = {
  PRIORITY: 'priority',   // layer merge off — one clip per channel
  COMBINE: 'combine',     // layer merge on, overlay off — sequential
  OVERLAY: 'overlay',     // layer merge on, overlay on — cut + blend
};

// Reuse the same transition-steps convention as the old mergeFrames path.
const TRANSITION_STEPS = 20;

function toFlat8(objPoints, sourceIsTyped) {
  const n = sourceIsTyped ? objPoints.length / 8 : objPoints.length;
  const out = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    if (sourceIsTyped) {
      out.set(objPoints.subarray(o, o + 8), o);
    } else {
      const p = objPoints[i];
      out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z || 0;
      out[o + 3] = p.r; out[o + 4] = p.g; out[o + 5] = p.b;
      out[o + 6] = p.blanking ? 1 : 0; out[o + 7] = p.lastPoint ? 1 : 0;
    }
  }
  out[(n - 1) * 8 + 7] = 1;
  return out;
}

export function isTyped(obj) {
  return !!obj && (obj instanceof Float32Array || (obj && obj.buffer instanceof ArrayBuffer));
}

// Apply a layer's blend-mode transform to every lit point of a flat buffer.
function applyBlendToFrame(flat, mode) {
  if (!mode || mode === BLEND.NORMAL) return flat;
  const n = flat.length / 8;
  for (let i = 0; i < n; i++) {
    if (flat[i * 8 + 6] === 1) continue; // skip blanks
    const col = applyBlend(flat, i, mode);
    flat[i * 8 + 3] = col[0]; flat[i * 8 + 4] = col[1]; flat[i * 8 + 5] = col[2];
  }
  return flat;
}

// Convert a clip frame into the normalized {points:Float32Array(8/pt), layerIndex, blend} form.
function normalizeClip(clip) {
  const typed = isTyped(clip.points);
  return {
    points: typed ? (clip.points instanceof Float32Array ? new Float32Array(clip.points) : toFlat8(clip.points, true)) : toFlat8(clip.points, false),
    layerIndex: clip.layerIndex ?? 0,
    blend: clip.blend || BLEND.NORMAL,
  };
}

// --- Priority mode -----------------------------------------------------------
// Return the single highest-priority clip (lowest layerIndex). If several clips
// share the same lowest layerIndex (e.g. multiple clips on the same layer routed
// to the same channel), fall back to the first one.
function composePriority(clips) {
  let winner = null;
  for (const c of clips) {
    if (!winner || c.layerIndex < winner.layerIndex) winner = c;
  }
  if (!winner) return null;
  const out = new Float32Array(winner.points);
  return applyBlendToFrame(out, winner.blend);
}

// --- Combine mode ------------------------------------------------------------
// Concatenate all clips sequentially with blanking transition steps between
// consecutive clips so the blanking circuit has time to settle between shapes.
function composeCombine(clips, budget) {
  if (clips.length === 1) {
    const out = new Float32Array(clips[0].points);
    applyBlendToFrame(out, clips[0].blend);
    return reduceFramePoints(out, out.length / 8, budget);
  }

  // Adaptive transition steps: travel blanks between clips are blanking-settle
  // points, but they must not starve the budget of the actual shapes. Shrink the
  // per-gap steps so the full timeline fits the channel budget when it's tight.
  const clipTotals = clips.map((c) => c.points.length / 8);
  const clipSum = clipTotals.reduce((a, b) => a + b, 0);
  const gaps = clips.length - 1;
  // Reserve budget for clips, distribute the remainder across the gaps.
  const available = Math.max(0, budget - clipSum);
  let steps = gaps > 0 ? Math.max(2, Math.floor(available / gaps)) : TRANSITION_STEPS;
  steps = Math.min(TRANSITION_STEPS, steps);

  const totalPoints = clipSum + gaps * steps;
  const out = new Float32Array(totalPoints * 8);
  let cur = 0;
  clips.forEach((c, idx) => {
    const pts = applyBlendToFrame(new Float32Array(c.points), c.blend);
    const n = pts.length / 8;
    out.set(pts, cur * 8);
    // Zero out lastPoint mid-stream; it is re-set at the very end.
    for (let i = 0; i < n; i++) out[(cur + i) * 8 + 7] = 0;
    cur += n;
    if (idx < clips.length - 1) {
      const next = clips[idx + 1].points;
      const lastX = pts[(n - 1) * 8];
      const lastY = pts[(n - 1) * 8 + 1];
      const nextX = next[0];
      const nextY = next[1];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const off = (cur + s - 1) * 8;
        out[off] = lastX + (nextX - lastX) * t;
        out[off + 1] = lastY + (nextY - lastY) * t;
        out[off + 6] = 1; // blank
        out[off + 3] = 0; out[off + 4] = 0; out[off + 5] = 0;
        out[off + 7] = 0;
      }
      cur += steps;
    }
  });
  out[(totalPoints - 1) * 8 + 7] = 1;
  // Enforce the channel budget after composing.
  return reduceFramePoints(out, totalPoints, budget);
}

// --- Overlay mode ------------------------------------------------------------
// Point-in-polygon culling (option a): a lit point of a lower-priority layer
// (higher layerIndex) that lands INSIDE the closed outline of any higher-priority
// clip is hidden / "cut" — it is behind the covering layer. Surviving points are
// composited with the per-layer blend mode applied to the lit color.
function applyBlend(flat, idx, mode) {
  if (mode === BLEND.ADD) {
    return [
      Math.min(1, flat[idx * 8 + 3] * 0.6 + 0.4),
      Math.min(1, flat[idx * 8 + 4] * 0.6 + 0.4),
      Math.min(1, flat[idx * 8 + 5] * 0.6 + 0.4),
    ];
  }
  if (mode === BLEND.SUBTRACT) {
    return [
      Math.max(0, flat[idx * 8 + 3] * 0.6),
      Math.max(0, flat[idx * 8 + 4] * 0.6),
      Math.max(0, flat[idx * 8 + 5] * 0.6),
    ];
  }
  return [flat[idx * 8 + 3], flat[idx * 8 + 4], flat[idx * 8 + 5]];
}

// Build a polygon (array of [x,y]) from a lit segment, deduping dwell repeats.
function litSegmentPolygon(flat, start, end) {
  const poly = [];
  let prevX = NaN, prevY = NaN;
  for (let i = start; i <= end; i++) {
    const x = flat[i * 8], y = flat[i * 8 + 1];
    if (x === prevX && y === prevY) continue; // dwell repeat
    poly.push([x, y]);
    prevX = x; prevY = y;
  }
  return poly;
}

// Ray-casting point-in-polygon test.
function pointInPolygon(px, py, poly) {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function composeOverlay(clips, budget) {
  // Lower layerIndex = higher priority (on top, occludes layers below it).
  const sorted = [...clips].sort((a, b) => a.layerIndex - b.layerIndex);

  // Precompute, for each higher-priority clip, the list of covering polygons
  // (one per lit segment that closes back on itself).
  const occluders = sorted.map((c) => {
    const pts = c.points;
    const n = pts.length / 8;
    const polys = [];
    for (const s of computeLitSegments(pts, n)) {
      const poly = litSegmentPolygon(pts, s.start, s.end);
      if (poly.length >= 3) {
        // Close the loop if first and last nearly coincide (closed shape).
        polys.push(poly);
      }
    }
    return polys;
  });

  // For each clip, mark which lit points are hidden inside a higher polygon.
  const coveredMasks = sorted.map((c, ci) => {
    const pts = c.points;
    const n = pts.length / 8;
    const mask = new Uint8Array(n);
    const higher = sorted.slice(0, ci); // strictly higher priority
    if (higher.length === 0) return mask;
    const occ = higher.map((_, hi) => occluders[hi]).flat();
    if (occ.length === 0) return mask;
    for (const s of computeLitSegments(pts, n)) {
      for (let i = s.start; i <= s.end; i++) {
        const px = pts[i * 8], py = pts[i * 8 + 1];
        for (const poly of occ) {
          if (pointInPolygon(px, py, poly)) { mask[i] = 1; break; }
        }
      }
    }
    return mask;
  });

  // Emit surviving points per clip, preserving blank structure + blend.
  const result = [];
  sorted.forEach((c, ci) => {
    const pts = c.points;
    const n = pts.length / 8;
    const mask = coveredMasks[ci];
    for (let i = 0; i < n; i++) {
      const blk = pts[i * 8 + 6] === 1;
      if (!blk && mask[i]) continue; // culled: inside a covering layer
      let r = pts[i * 8 + 3], g = pts[i * 8 + 4], b = pts[i * 8 + 5];
      if (!blk) {
        const col = applyBlend(pts, i, c.blend);
        r = col[0]; g = col[1]; b = col[2];
      }
      result.push({
        x: pts[i * 8], y: pts[i * 8 + 1], z: pts[i * 8 + 2],
        r, g, b, isblank: blk,
      });
    }
  });

  if (result.length === 0) return new Float32Array(0);
  const flat = new Float32Array(result.length * 8);
  result.forEach((p, i) => {
    const o = i * 8;
    flat[o] = p.x; flat[o + 1] = p.y; flat[o + 2] = p.z || 0;
    flat[o + 3] = p.r; flat[o + 4] = p.g; flat[o + 5] = p.b;
    flat[o + 6] = p.isblank ? 1 : 0;
    flat[o + 7] = 0;
  });
  flat[(result.length - 1) * 8 + 7] = 1;
  return reduceFramePoints(flat, result.length, budget, computeLitSegments(flat, result.length));
}

/**
 * Compose the frames of the clips assigned to one DAC channel into a single
 * budget-constrained flat frame suitable for the DAC path.
 *
 * @param {Array<object>} clips  channel clips: each {points, layerIndex?, blend?, isTypedArray?}
 * @param {number} budget        per-channel point budget (targetPPS/targetFPS)
 * @param {string} mode          MERGE_MODE.PRIORITY | COMBINE | OVERLAY
 * @returns {Float32Array} flat 8-float frame
 */
export function composeChannelFrame(clips, budget, mode) {
  if (!clips || clips.length === 0) return new Float32Array(0);
  const normClips = clips.map(normalizeClip);

  if (mode === MERGE_MODE.OVERLAY) {
    return composeOverlay(normClips, budget);
  }
  if (mode === MERGE_MODE.COMBINE) {
    return composeCombine(normClips, budget);
  }
  // PRIORITY (default)
  const winner = composePriority(normClips);
  return winner || new Float32Array(0);
}

export default composeChannelFrame;
