// Vector-native ILDA remastering (Area 6).
//
// The legacy parser returns exactly the point density the file author stored.
// This module converts those points into safe vector geometry: it groups lit
// samples into paths (moving a blanked pen splits a path) and, when the gap
// between two consecutive lit points would exceed the scanner's velocity
// ceiling at the target PPS, subdivides the span with interpolated samples so
// the path stays drawable end-to-end.
//
// The velocity ceiling uses normalized-coordinate math (see
// computePassthroughStepCeiling): it maps the scanner's physical max travel
// (2m/s default) onto the -1..1 display space and scales it linearly with the
// actual output PPS. This is a MINIMUM density pass — overly-dense ILDA content
// is left intact and decimated downstream by the optimizer point budget.

import { computePassthroughStepCeiling } from './speedTarget.js';

export const VECTOR_PARSE_DEFAULT_PPS = 30000;
export const VECTOR_PARSE_MAX_POINTS = 4000;

/**
 * Split a raw point list into lit paths (blanking moves start a new path).
 * @param {Array<{x,y,z?,r,g,b,blanking?,lastPoint?}>} points
 * @returns {Array<Array>} array of paths, each an array of lit points
 */
export function buildLitPaths(points) {
  const paths = [];
  let current = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p && !p.blanking && (p.x !== undefined || p.y !== undefined)) {
      current.push(p);
    } else if (current.length > 0) {
      paths.push(current);
      current = [];
    }
  }
  if (current.length > 0) paths.push(current);
  return paths;
}

/**
 * Interpolate a single lit path so no step exceeds `maxStep` display units.
 * Emits the source points, inserting evenly-spaced samples on over-long spans.
 * @param {Array} path  array of lit points
 * @param {number} maxStep  maximum allowed advance per sample (display units)
 * @returns {Array} remastered path (first/last points preserved, lastPoint set)
 */
export function enforceStepCeiling(path, maxStep) {
  if (path.length <= 1) return path.slice();
  if (!(maxStep > 0) || !Number.isFinite(maxStep)) return path.slice();

  const out = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const head = { ...a, lastPoint: false };
    // Keep color/blanking consistent for the emitted points; blanking flags
    // on interior points of a lit run are never set (they end the path).
    if (head.blanking === undefined) head.blanking = false;
    out.push(head);
    if (!b) break;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxStep) {
      const steps = Math.max(2, Math.ceil(dist / maxStep));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push({
          x: a.x + dx * t,
          y: a.y + dy * t,
          z: a.z !== undefined ? a.z + ((b.z || 0) - (a.z || 0)) * t : 0,
          r: a.r, g: a.g, b: a.b,
          blanking: false,
          lastPoint: false,
        });
      }
    }
  }
  out[out.length - 1].lastPoint = true;
  return out;
}

/**
 * Vector-remaster one frame's raw points under the ILDA velocity ceiling.
 *
 * @param {Array<{x,y,r,g,b,blanking?,lastPoint?}>} rawPoints
 * @param {object} [opts]
 * @param {number} [opts.pps=30000]  output PPS used to derive the ceiling
 * @param {number} [opts.maxPoints=4000]  hard cap on total emitted points
 * @returns {{ points: Array, paths: Array<Array>, ceiling: number }}
 */
export function vectorizeIldaFrame(rawPoints, opts = {}) {
  const pps = opts.pps > 0 ? opts.pps : VECTOR_PARSE_DEFAULT_PPS;
  const maxPoints = opts.maxPoints > 0 ? opts.maxPoints : VECTOR_PARSE_MAX_POINTS;
  const ceiling = computePassthroughStepCeiling(pps);

  const paths = buildLitPaths(rawPoints);
  let merged = [];
  const remasteredPaths = [];
  for (const path of paths) {
    const bounded = enforceStepCeiling(path, ceiling);
    remasteredPaths.push(bounded);
    merged = merged.concat(bounded);
  }

  // Safety: never blow past the passthrough ceiling even for pathological files.
  if (merged.length > maxPoints) {
    const stride = Math.ceil(merged.length / maxPoints);
    const downsampled = [];
    for (let i = 0; i < merged.length; i += stride) downsampled.push(merged[i]);
    const last = downsampled[downsampled.length - 1];
    if (last) last.lastPoint = true;
    merged = downsampled;
  }

  return { points: merged, paths: remasteredPaths, ceiling };
}

export default {
  buildLitPaths,
  enforceStepCeiling,
  vectorizeIldaFrame,
  VECTOR_PARSE_DEFAULT_PPS,
  VECTOR_PARSE_MAX_POINTS,
};