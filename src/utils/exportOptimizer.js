// --- Export Point-Count Intelligence ---
//
// Reduces the raw sampled point soup produced by the Shape Builder into a
// laser-friendly point count without destroying the drawing's shape:
//   * adaptive detail  - collinear runs are collapsed via Douglas-Peucker.
//   * anchor points    - corners are auto-detected and kept, and the user can
//                        pin extra keep-points that are never decimated.
//   * frame budget     - the total ILDA points per frame is capped so the DAC
//                        stays within its point clock.

// Target ILDA points per exported frame. At ~20k points/sec a 30fps stream
// fits about 660 pts/frame; 1200 leaves headroom for dense shapes on slower
// clocks while still being far below what the Shape Builder could emit raw.
export const DEFAULT_POINT_BUDGET = 1200;

// How big a deviation from a segment may be before the point must be kept,
// expressed as a fraction of the shape's bounding-box diagonal.
export const DEFAULT_RELATIVE_TOLERANCE = 0.006;

// Marks "corner" points: locations where the polyline turns by more than
// `angleDeg` AND both adjacent spans are at least `minArm` long. Such corners
// must always survive decimation or the drawing visibly changes shape.
export function detectCornerAnchors(pts, { angleDeg = 18, minArm = 3 } = {}) {
  const anchors = new Set();
  if (!pts || pts.length < 3) return anchors;
  const threshold = (angleDeg * Math.PI) / 180;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if (!a || !b || !c) continue;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const lab = Math.hypot(abx, aby);
    const lbc = Math.hypot(bcx, bcy);
    if (lab < minArm || lbc < minArm) continue;
    const cosA = Math.max(-1, Math.min(1, (abx * bcx + aby * bcy) / (lab * lbc)));
    const sinA = Math.abs(abx * bcy - aby * bcx) / (lab * lbc);
    if (Math.abs(Math.atan2(sinA, cosA)) > threshold) anchors.add(i);
  }
  return anchors;
}

export function boundingBox(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function distToSegmentSq(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + t * abx);
  const dy = p.y - (a.y + t * aby);
  return dx * dx + dy * dy;
}

// Ramsey-White / Douglas-Peucker recursion over the index range (i0,i1].
// Only interior points that deviate more than `tol` are kept.
function rdp(pts, i0, i1, tol, out) {
  const a = pts[i0];
  const b = pts[i1];
  let maxDistSq = -1;
  let mid = -1;
  for (let i = i0 + 1; i < i1; i++) {
    const d = distToSegmentSq(pts[i], a, b);
    if (d > maxDistSq) {
      maxDistSq = d;
      mid = i;
    }
  }
  if (maxDistSq > tol * tol && mid >= 0) {
    if (mid - i0 > 1) rdp(pts, i0, mid, tol, out);
    out.push(mid);
    if (i1 - mid > 1) rdp(pts, mid, i1, tol, out);
  }
}

// Decimate `pts` keeping the profile of a set of `protected` indices plus the
// two endpoints. Protected indices act as hard boundaries between RDP runs so
// they can never be dropped.
export function decimateKeep(pts, protectedIndices, tolerance) {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const boundaries = new Set([0, n - 1]);
  protectedIndices.forEach(i => {
    if (i > 0 && i < n - 1) boundaries.add(i);
  });
  const sorted = [...boundaries].sort((a, b) => a - b);
  const kept = [0];
  for (let k = 0; k < sorted.length - 1; k++) {
    const s = sorted[k];
    const e = sorted[k + 1];
    if (e - s <= 1) {
      if (e !== s) kept.push(e);
      continue;
    }
    rdp(pts, s, e, tolerance, kept);
    kept.push(e);
  }
  return kept;
}

// Evenly thin to a target count while refusing to drop endpoints or protected
// anchor points. Used when decimation alone cannot reach the budget.
export function thinToTarget(pts, protectedIndices, target) {
  const n = pts.length;
  if (n <= target) return pts.map((_, i) => i);
  const keep = new Set(protectedIndices);
  keep.add(0);
  keep.add(n - 1);
  const free = [];
  for (let i = 1; i < n - 1; i++) if (!keep.has(i)) free.push(i);
  let remaining = Math.max(0, Math.min(target, n)) - keep.size;
  if (remaining >= free.length) return [...keep].sort((a, b) => a - b);
  const step = free.length / (remaining + 1);
  let acc = step;
  for (const idx of free) {
    if (remaining <= 0) break;
    acc -= 1;
    if (acc <= 0) {
      acc += step;
      keep.add(idx);
      remaining--;
    }
  }
  return [...keep].sort((a, b) => a - b);
}

// Evenly sprinkle back indices until `target` is reached (inverse of thinning).
// Used to guarantee every shape keeps at least minCount points.
export function padToTarget(pts, keptIndices, target) {
  const keep = new Set(keptIndices);
  if (pts.length <= target) return pts.map((_, i) => i);
  let missing = Math.min(target, pts.length) - keep.size;
  if (missing <= 0) return [...keep].sort((a, b) => a - b);
  const free = [];
  for (let i = 1; i < pts.length - 1; i++) if (!keep.has(i)) free.push(i);
  const step = free.length / missing;
  let acc = 0;
  for (const idx of free) {
    if (missing <= 0) break;
    acc += step;
    if (acc >= 1) {
      acc = 0;
      keep.add(idx);
      missing--;
    }
  }
  return [...keep].sort((a, b) => a - b);
}

// Optimize a single shape's sampled points.
//   opts.tolerance     - explicit absolute tolerance (overrides relativeTol)
//   opts.relativeTol   - tolerance as a fraction of the bbox diagonal
//   opts.preserve      - Set (or array) of extra indices that must be kept
//   opts.targetCount   - hard cap on the returned point count
//   opts.minCount      - absolute floor on the returned point count
//   opts.detectCorners - run corner auto-detection (default true)
// Returns { points, indexes } where indexes map into the input `pts` array.
export function optimizeShapePoints(pts, opts = {}) {
  if (!pts || pts.length < 2) return { points: pts || [], indexes: pts ? pts.map((_, i) => i) : [] };

  // keepAll: the caller explicitly asked for this exact point set (a user-chosen
  // point density, or a resample needed to give a per-point beam style something
  // to draw). Decimating here would undo that request: the resampled points are
  // collinear within each segment, so RDP collapses them right back to the
  // original sparse outline. Keep the whole set, and only thin it evenly to the
  // frame budget when it genuinely cannot fit.
  if (opts.keepAll) {
    let kept = pts.map((_, i) => i);
    if (opts.targetCount && kept.length > opts.targetCount) {
      kept = thinToTarget(pts, new Set(), opts.targetCount);
    }
    if (opts.minCount && kept.length < opts.minCount) {
      kept = padToTarget(pts, kept, opts.minCount);
    }
    return { points: kept.map(i => pts[i]), indexes: kept };
  }

  let protectedIndices = new Set(opts.preserve || []);
  if (opts.detectCorners !== false) {
    const corners = detectCornerAnchors(pts);
    corners.forEach(i => protectedIndices.add(i));
  }

  const bb = boundingBox(pts);
  const diag = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) || 1;
  let tolerance = opts.tolerance !== undefined
    ? opts.tolerance
    : (opts.relativeTol ?? DEFAULT_RELATIVE_TOLERANCE) * diag;

  let indexes = decimateKeep(pts, protectedIndices, tolerance);

  if (opts.targetCount && indexes.length > opts.targetCount) {
    let t = tolerance;
    let steps = 0;
    while (indexes.length > opts.targetCount && steps < 8 && t < diag) {
      t *= 2;
      indexes = decimateKeep(pts, protectedIndices, t);
      steps++;
    }
    if (indexes.length > opts.targetCount) {
      indexes = thinToTarget(pts, protectedIndices, opts.targetCount);
    }
  }

  if (opts.minCount && indexes.length < opts.minCount) {
    indexes = padToTarget(pts, indexes, opts.minCount);
  }

  return { points: indexes.map(i => pts[i]), indexes };
}

// Sequential per-frame optimizer that carries a shared ILDA point budget
// across every shape drawn in the frame. Internal accounting converts the
// ILDA budget into a sampled-point allowance (each sampled segment emits two
// ILDA points) and reserves one blanked move point per shape.
export function createPointBudgetOptimizer({ budget = DEFAULT_POINT_BUDGET } = {}) {
  let remaining = Math.max(2, Math.floor(budget / 2) - 2);
  return {
    get remaining() {
      return remaining;
    },
    processShape(pts, opts = {}) {
      if (!pts || pts.length < 2) return { points: pts || [], indexes: pts ? pts.map((_, i) => i) : [] };
      const minPoints = opts.minPoints ?? 4;
      const allowance = Math.max(minPoints, remaining);
      return optimizeShapePoints(pts, { ...opts, targetCount: allowance, minCount: minPoints });
    },
    accountFor(shapePointCount) {
      // subtract the sampled points plus the blanked move point this shape adds
      remaining = Math.max(0, remaining - shapePointCount - 1);
    }
  };
}