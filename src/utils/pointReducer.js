// pointReducer.js
// Shape-preserving point-budget reduction for the DAC channel merge step.
//
// Fundamental rule (per the galvo/hardware model): the per-channel point budget
// is the max points a channel can render at a stable PPS given the frame rate
// (budget = targetPPS / targetFPS). When a merged channel frame overflows that
// budget we must drop points WITHOUT destroying the shape and WITHOUT stripping
// corner dwell / blanking structure.
//
// Strategy:
//   * Split geometry into lit runs (contiguous non-blanked segments) and blank
//     points. Blank points are structural (they prevent ghost lines between
//     disjoint shapes) and are NEVER reduced.
//   * Only lit points are reduced, using Douglas-Peucker applied independently
//     per lit segment. Douglas-Peucker keeps a recursion's farthest-from-chord
//     point, so sharp corners survive by construction (they sit farthest from
//     the chord). Corner-dwell repeats coincide with the kept corner vertex,
//     so they are not double-counted as removable.
//   * A per-segment budget proportional to arc length keeps detail on curves
//     while decimating straight runs — far better than uniform stride.
//
// The 8-float typed layout is: x,y,z,r,g,b,blanking(0/1),lastPoint(0/1)

// Split a flat typed point buffer into lit-run segments (inclusive index ranges).
// Reuses the same convention as ilda-parser.worker computeSegments.
export function computeLitSegments(flatPoints, numPoints) {
  const segments = [];
  let runStart = -1;
  for (let i = 0; i < numPoints; i++) {
    const blanking = flatPoints[i * 8 + 6] === 1;
    if (!blanking && runStart === -1) runStart = i;
    if ((blanking || i === numPoints - 1) && runStart !== -1) {
      const runEnd = blanking ? i - 1 : i;
      if (runEnd >= runStart) segments.push({ start: runStart, end: runEnd });
      runStart = -1;
    }
  }
  return segments;
}

const clampIdx = (v, max) => (v < 0 ? 0 : v > max ? max : v);

// Distances (squared/full) helpers over the flat layout.
function ptDistanceSq(flat, a, b) {
  const dx = flat[a * 8] - flat[b * 8];
  const dy = flat[a * 8 + 1] - flat[b * 8 + 1];
  return dx * dx + dy * dy;
}
function ptDistance(flat, a, b) {
  return Math.sqrt(ptDistanceSq(flat, a, b));
}

// Perpendicular distance from point p to the segment a-b, squared.
function pointSegDistanceSq(flat, p, a, b) {
  const ax = flat[a * 8], ay = flat[a * 8 + 1];
  const bx = flat[b * 8], by = flat[b * 8 + 1];
  const px = flat[p * 8], py = flat[p * 8 + 1];
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return ptDistanceSq(flat, p, a);
  const t = clampIdx(((px - ax) * dx + (py - ay) * dy) / lenSq, 1);
  const cx = ax + t * dx, cy = ay + t * dy;
  const rx = px - cx, ry = py - cy;
  return rx * rx + ry * ry;
}

// Douglas-Peucker over the inclusive range [start, end]. `keep` is a Uint8Array
// marking which source indices are retained; we visit interior points and mark
// those farthest from the chord, recursing, until `budgetRemaining` runs out.
// Always keeps start and end (caller marks those).
function douglasPeuckerMark(flat, keep, start, end, budgetRemaining) {
  const n = end - start + 1;
  if (n <= 2 || budgetRemaining <= 0) return 0;
  // Find the interior point farthest from the start-end chord.
  let maxDistSq = -1, split = -1;
  for (let i = start + 1; i < end; i++) {
    const d = pointSegDistanceSq(flat, i, start, end);
    if (d > maxDistSq) { maxDistSq = d; split = i; }
  }
  if (split === -1 || maxDistSq < 0) return 0;
  // We want the final kept set ~= budgetRemaining total interior points across
  // this subtree. Mark the farthest point, then split recursively.
  let used = 0;
  // Reserve one for this split point; then distribute the rest to children.
  const leftSpan = split - start;
  const rightSpan = end - split;
  const totalSpan = leftSpan + rightSpan;
  const leftBudget = totalSpan === 0 ? 0 : Math.round((budgetRemaining - 1) * (leftSpan / totalSpan));
  const rightBudget = (budgetRemaining - 1) - leftBudget;
  if (leftBudget > 0 && leftSpan >= 2) {
    used += douglasPeuckerMark(flat, keep, start, split, leftBudget);
  }
  keep[split] = 1;
  used += 1;
  if (rightBudget > 0 && rightSpan >= 2) {
    used += douglasPeuckerMark(flat, keep, split, end, rightBudget);
  }
  return used;
}

/**
 * Reduce a flat typed point array down to `budget` points while preserving the
 * shape. Returns a new Float32Array (or the original if no reduction needed).
 *
 * @param {Float32Array|Array} points  flat 8-float layout
 * @param {number} numPoints           number of points
 * @param {number} budget              maximum number of points to keep
 * @param {Array<{start,end}>} [segments] optional precomputed lit segments to
 *                                        avoid rescans; otherwise computed here
 * @returns {Float32Array} reduced flat buffer
 */
export function reduceFramePoints(points, numPoints, budget, segments) {
  budget = Math.max(1, Math.floor(budget));
  if (numPoints <= budget) {
    // No-op fast path for the hot loop.
    if (points instanceof Float32Array) return points;
    return new Float32Array(points);
  }

  const segs = segments || computeLitSegments(points, numPoints);

  // Count blank points (always kept) and total lit arc length per segment.
  const blankSet = new Uint8Array(numPoints);
  let blankCount = 0;
  const isBlank = (i) => points[i * 8 + 6] === 1;
  for (let i = 0; i < numPoints; i++) {
    if (isBlank(i)) { blankSet[i] = 1; blankCount++; }
  }

  // litSegment info: {start,end,len(arc)};
  const litInfo = [];
  let totalLitLen = 0;
  for (const s of segs) {
    let len = 0;
    for (let i = s.start + 1; i <= s.end; i++) len += ptDistance(points, i - 1, i);
    litInfo.push({ start: s.start, end: s.end, len });
    totalLitLen += len;
  }

  const litBudget = budget - blankCount;
  if (litBudget <= 0) {
    // Can't afford any lit points — keep only blanks.
    const out = new Float32Array(blankCount * 8);
    let o = 0;
    for (let i = 0; i < numPoints; i++) {
      if (blankSet[i]) {
        for (let k = 0; k < 8; k++) out[o * 8 + k] = points[i * 8 + k];
        o++;
      }
    }
    if (out.length) out[out.length - 1 - 7 + 7] = 1; // set lastPoint on last
    return out;
  }

  // Build a keep mask: lit interior points are dropped unless DP marks them.
  const keep = new Uint8Array(numPoints);
  for (const info of litInfo) {
    const { start, end, len } = info;
    const span = end - start + 1;
    // Proportional sub-budget for this segment by arc length.
    const segBudget = totalLitLen === 0
      ? Math.max(1, Math.floor(litBudget * (span / numPoints)))
      : Math.max(1, Math.floor(litBudget * (len / totalLitLen)));
    // Always keep the two endpoints of every lit segment.
    keep[start] = 1;
    keep[end] = 1;
    if (span > 2 && segBudget > 2) {
      douglasPeuckerMark(points, keep, start, end, segBudget - 2);
    }
  }

  // Drop every lit interior point that DP did not mark.
  const dropped = [];
  for (const info of litInfo) {
    for (let i = info.start + 1; i < info.end; i++) {
      if (!keep[i]) dropped.push(i);
    }
  }

  // Reassemble in original order: blanks + surviving lit points.
  const out = new Float32Array((numPoints - dropped.length) * 8);
  let o = 0;
  // Preserve the original sequence so blanks still separate shapes correctly.
  const droppedSet = new Uint8Array(numPoints);
  for (const i of dropped) droppedSet[i] = 1;
  for (let i = 0; i < numPoints; i++) {
    if (!droppedSet[i]) {
      for (let k = 0; k < 8; k++) out[o * 8 + k] = points[i * 8 + k];
      o++;
    }
  }
  if (o > 0) out[(o - 1) * 8 + 7] = 1; // lastPoint on last
  return out;
}

export default reduceFramePoints;
