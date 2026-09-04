// Shared vector-path construction and sampling for generators (Area 4).
// Generators build plain geometry (vertex lists) and hand off to these helpers
// so point density is distributed by arc length (uniform spacing along the
// path) instead of being hard-coded per shape. This lets the same shape render
// correctly at any point budget and keeps edges evenly lit.

const clampPointCount = (count) => Math.max(2, Math.round(count));

/**
 * Distribute up to `count` points across a polyline/polygon vertex list,
 * spacing them proportionally to each segment's arc length.
 *
 * @param {Array<{x:number,y:number}>} vertices
 * @param {number} count  requested number of samples
 * @param {Object} [opts]
 * @param {boolean} [opts.closed=false]  treat the vertex list as a closed loop
 * @returns {Array<{x:number,y:number}>}
 */
export function samplePath(vertices, count, { closed = false } = {}) {
  const n = clampPointCount(count);
  if (!vertices || vertices.length < 2) return [];

  const loop = closed ? vertices.length : vertices.length - 1;
  const segs = [];
  const cum = [0];
  let total = 0;
  for (let i = 0; i < loop; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, len });
    total += len;
    cum.push(total);
  }

  if (total <= 0) {
    return Array.from({ length: n }, () => ({ x: vertices[0].x, y: vertices[0].y }));
  }

  const samples = [];
  const intervals = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const d = intervals > 0 ? (i / intervals) * total : 0;
    let si = 0;
    while (si < segs.length - 1 && d > cum[si + 1]) si++;
    const s = segs[si];
    const t = s.len > 0 ? (d - cum[si]) / s.len : 0;
    samples.push({
      x: s.a.x + (s.b.x - s.a.x) * t,
      y: s.a.y + (s.b.y - s.a.y) * t,
    });
  }
  return samples;
}

/** Convenience forwarding for open polylines. */
export function samplePolyline(vertices, count) {
  return samplePath(vertices, count, { closed: false });
}

/** Evenly space `count` points around a circle (arc-length uniform). */
export function sampleCircle(cx, cy, radius, count) {
  const n = Math.max(3, Math.round(count));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) });
  }
  return pts;
}

export default {
  samplePath,
  samplePolyline,
  sampleCircle,
};