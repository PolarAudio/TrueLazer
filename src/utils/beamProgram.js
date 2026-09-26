// Shape -> beam program.
//
// A single source of truth for how a shape's outline becomes laser output. The
// Shape Builder preview and the ILDA export both call into this module, which is
// what makes the editor WYSIWYG: a dash is the same length on screen and on the
// DAC, and a dot is at the same position in both.
//
// Two rules drive the design:
//
//  1. Beam patterns are measured in ARC LENGTH along the outline, never by sample
//     index. An index-based `i % 2` dash changes its dash length every time the
//     point density or the curve sampling changes, so a dashed circle drawn from
//     32 samples and the same circle drawn from 200 samples are different
//     pictures. Arc length makes the pattern independent of sampling.
//  2. The program respects a point budget. Dots need dwell (several points held
//     on one spot) to be visible, and dwell multiplies the point count, so the
//     dot pitch / dash length are stretched to fit rather than silently
//     overrunning the DAC's point-per-second clock.

import { DEFAULT_POINT_BUDGET } from './exportOptimizer';

// Render modes. Kept in sync with the Shape Builder's mode buttons.
export const BEAM_MODES = ['simple', 'dotted', 'dashed', 'points'];

// Closed outline types. A polyline/pen/bezier is open unless told otherwise.
const CLOSED_TYPES = new Set(['polygon', 'rect', 'circle', 'star', 'triangle']);

// Defaults chosen to read well on a 1000x1000 canvas: a dot every 8px, a dash
// of 16px with a 10px gap, and 20 dwell points per dot (~1ms at 20kpps, which is
// what makes a dot visible without burning a visible blob).
export const DEFAULT_DOT_PITCH = 8;
export const DEFAULT_DASH_LENGTH = 16;
export const DEFAULT_GAP_LENGTH = 10;
export const DEFAULT_DWELL = 20;

export function isClosedType(type) {
  return CLOSED_TYPES.has(type);
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Cumulative arc length for an outline, plus the closing segment for closed
// shapes. `cum[i]` is the distance from the first point to point i.
export function measureOutline(pts, closed = false) {
  const n = pts ? pts.length : 0;
  const cum = new Float64Array(Math.max(n, 1));
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + dist(pts[i - 1], pts[i]);
  let total = n > 1 ? cum[n - 1] : 0;
  if (closed && n > 2) total += dist(pts[n - 1], pts[0]);
  return { pts: pts || [], closed, cum, total, count: n };
}

// Position and colour at a given arc length. Colours are taken from the nearer
// endpoint of the containing segment so per-point gradient colours survive.
export function pointAtDistance(m, d) {
  const { pts, closed, cum, total } = m;
  const n = pts.length;
  if (n === 0) return null;
  if (n === 1 || !(total > 0)) return pts[0];
  if (d <= 0) return pts[0];
  if (d >= total) return closed ? pts[0] : pts[n - 1];

  // The closing segment of a closed outline runs past cum[n-1].
  if (closed && d > cum[n - 1]) {
    const a = pts[n - 1];
    const b = pts[0];
    const len = dist(a, b) || 1e-9;
    const f = (d - cum[n - 1]) / len;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, color: f < 0.5 ? a.color : b.color };
  }

  let i = 1;
  while (i < n - 1 && cum[i] < d) i++;
  const segLen = cum[i] - cum[i - 1] || 1e-9;
  const f = (d - cum[i - 1]) / segLen;
  const a = pts[i - 1];
  const b = pts[i];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, color: f < 0.5 ? a.color : b.color };
}

// Dash/gap runs covering the whole outline, in arc-length space.
export function dashRuns(m, { dashLength = DEFAULT_DASH_LENGTH, gapLength = DEFAULT_GAP_LENGTH } = {}) {
  const runs = [];
  if (!(m.total > 0)) return runs;
  const dash = dashLength > 0 ? dashLength : m.total;
  const gap = gapLength > 0 ? gapLength : 0;
  let d = 0;
  let guard = 0;
  while (d < m.total - 1e-9 && guard < 100000) {
    const onEnd = Math.min(d + dash, m.total);
    runs.push({ from: d, to: onEnd, blanked: false });
    if (onEnd >= m.total - 1e-9) break;
    const offEnd = Math.min(onEnd + gap, m.total);
    runs.push({ from: onEnd, to: offEnd, blanked: true });
    d = offEnd;
    guard++;
  }
  return runs;
}

// The outline's own points that fall inside a run, plus the run's exact ends.
// Reusing the outline's points (instead of resampling) keeps the beam on exactly
// the geometry the preview strokes.
export function pointsInRun(m, run) {
  const { pts, closed, cum } = m;
  const n = pts.length;
  const out = [pointAtDistance(m, run.from)];
  const lastIdx = closed ? n : n - 1;
  for (let i = 1; i <= lastIdx; i++) {
    const d = cum[i];
    if (d > run.from + 1e-9 && d < run.to - 1e-9) out.push(pts[i]);
  }
  out.push(pointAtDistance(m, run.to));
  return out;
}

// Evenly spaced stations along the outline, used for dot positions.
export function dotStations(m, pitch = DEFAULT_DOT_PITCH) {
  const out = [];
  if (!(m.total > 0)) return m.count ? [{ ...m.pts[0], d: 0 }] : [];
  const step = pitch > 0 ? pitch : m.total;
  let d = 0;
  let guard = 0;
  while (d < m.total - 1e-9 && guard < 100000) {
    out.push({ ...pointAtDistance(m, d), d });
    d += step;
    guard++;
  }
  if (!out.length) out.push({ ...pointAtDistance(m, 0), d: 0 });
  return out;
}

// Budget-aware pattern selection.
//
// The dash runs and dot stations are chosen ONCE here and used by both the
// preview and the export. When a shape is too expensive for the point budget
// (dots need dwell, so they multiply the count) the pattern is stretched rather
// than truncated. Because both callers go through these resolvers, the pattern
// that gets stretched is the same on screen and in the file — otherwise a dense
// dashed shape would preview with 16px dashes and export with 40px ones.

// Points the budget allows for a single shape before it starts stretching.
export function defaultBeamPointAllowance(budget = DEFAULT_POINT_BUDGET) {
  return Math.max(8, Math.floor(budget / 2) - 2);
}

function runPointCount(m, runs) {
  let n = 0;
  for (const r of runs) n += pointsInRun(m, r).length;
  return n;
}

// Dash runs fitted to the point budget. Returns the runs plus the (possibly
// stretched) lengths so callers can report what was actually used.
export function resolveDashRuns(m, { dashLength = DEFAULT_DASH_LENGTH, gapLength = DEFAULT_GAP_LENGTH, maxPoints = Infinity } = {}) {
  let dash = dashLength;
  let gap = gapLength;
  let runs = dashRuns(m, { dashLength: dash, gapLength: gap });
  let scaled = false;
  for (let i = 0; i < 6 && runPointCount(m, runs) > maxPoints; i++) {
    const est = runPointCount(m, runs);
    const scale = Math.max(1.05, est / maxPoints);
    dash *= scale;
    gap *= scale;
    runs = dashRuns(m, { dashLength: dash, gapLength: gap });
    scaled = true;
  }
  return { runs, dashLength: dash, gapLength: gap, scaled };
}

// Dot stations fitted to the point budget. `outlineCount` is the number of
// points a dotted line still has to draw underneath the dots.
export function resolveDotStations(m, { pitch = DEFAULT_DOT_PITCH, dwell = DEFAULT_DWELL, drawsLine = false, outlineCount = 0, maxPoints = Infinity } = {}) {
  const perDot = Math.max(1, Math.round(dwell)) + (drawsLine ? 0 : 1);
  let usePitch = pitch > 0 ? pitch : DEFAULT_DOT_PITCH;
  let stations = dotStations(m, usePitch);
  const estimate = (st) => st.length * perDot + (drawsLine ? outlineCount : st.length);
  let scaled = false;
  for (let i = 0; i < 8 && estimate(stations) > maxPoints; i++) {
    const est = estimate(stations);
    usePitch *= Math.max(1.1, est / maxPoints);
    stations = dotStations(m, usePitch);
    scaled = true;
  }
  return { stations, pitch: usePitch, scaled };
}

function resolveColor(p, fallback) {
  return { x: p.x, y: p.y, color: p.color || fallback, blanking: false };
}

// Build the full beam program for one outline.
//
//   mode 'simple' - the outline, drawn solid
//   mode 'dashed' - the outline broken into dashes with blanked gaps
//   mode 'dotted' - the outline drawn solid, with a dwell dot every `pitch`
//   mode 'points' - dwell dots only, joined by blanked moves (no line)
//
// Returns { points, metrics, runs, stations, stats } in outline coordinates with
// a `blanking` flag; the caller maps to ILDA's -1..1 / RGB space.
export function buildBeamProgram(pts, opts = {}) {
  const {
    closed = false,
    mode = 'simple',
    pitch = DEFAULT_DOT_PITCH,
    dashLength = DEFAULT_DASH_LENGTH,
    gapLength = DEFAULT_GAP_LENGTH,
    dwell = DEFAULT_DWELL,
    color: fallbackColor,
    maxPoints = Infinity,
  } = opts;

  const m = measureOutline(pts, closed);
  const out = [];
  const stats = { mode, dwell, pitch, dashLength, gapLength, dots: 0, scaled: false };

  if (m.count < 2 || !(m.total > 0)) {
    return { points: out, metrics: m, runs: [], stations: [], stats };
  }

  const push = (p, blanking) => {
    const r = resolveColor(p, fallbackColor);
    r.blanking = !!blanking;
    out.push(r);
  };

  if (mode === 'dashed') {
    const { runs, dashLength: dash, gapLength: gap, scaled } = resolveDashRuns(m, { dashLength, gapLength, maxPoints });
    runs.forEach((r) => {
      pointsInRun(m, r).forEach((p) => push(p, r.blanked));
    });
    stats.dashLength = dash;
    stats.gapLength = gap;
    stats.scaled = scaled;
    return { points: out, metrics: m, runs, stations: [], stats };
  }

  if (mode === 'points' || mode === 'dotted') {
    const drawsLine = mode === 'dotted';
    const { stations, pitch: usePitch, scaled } = resolveDotStations(m, {
      // A closed outline emits one extra vertex to close the loop, so the cost
      // estimate has to count it or the pattern stretches a step too early.
      pitch, dwell, drawsLine, outlineCount: closed ? m.count + 1 : m.count, maxPoints,
    });
    const hold = Math.max(1, Math.round(dwell));

    if (drawsLine) {
      // The line, with the beam dwelling on each station as it passes. A closed
      // outline walks count + 1 vertices: the last one closes the loop back onto
      // the first point, which the closing segment of measureOutline covers but
      // the point list does not contain.
      const { cum } = m;
      let si = 0;
      const dwellAt = () => {
        for (let k = 0; k < hold; k++) push(stations[si], false);
        si++;
      };
      const last = closed ? m.count : m.count - 1;
      for (let i = 0; i <= last; i++) {
        const isClosing = closed && i === m.count;
        const d = isClosing ? m.total : (closed && i === 0 ? 0 : cum[i]);
        while (si < stations.length && stations[si].d <= d + 1e-9) dwellAt();
        push(isClosing ? m.pts[0] : m.pts[i], false);
      }
      while (si < stations.length) dwellAt();
    } else {
      // Dots only: blanked move to the station, then dwell on it.
      stations.forEach((st) => {
        push(st, true);
        for (let k = 0; k < hold; k++) push(st, false);
      });
    }
    stats.pitch = usePitch;
    stats.dots = stations.length;
    stats.scaled = scaled;
    return { points: out, metrics: m, runs: [], stations, stats };
  }

  // simple: the outline as drawn.
  for (let i = 0; i < m.count; i++) push(m.pts[i], false);
  if (closed) push(m.pts[0], false);
  return { points: out, metrics: m, runs: [], stations: [], stats };
}
