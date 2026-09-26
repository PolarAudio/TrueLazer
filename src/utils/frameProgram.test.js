import { describe, it, expect } from 'vitest';
import {
  buildFrameProgram,
  effectiveSpacingFor,
  toIldaPoint,
  BEAM_AUTO_SPACING,
} from './frameProgram';
import { DEFAULT_POINT_BUDGET } from './exportOptimizer';
import { DEFAULT_DOT_PITCH, DEFAULT_DWELL } from './beamProgram';

// --- Minimal stand-ins for the editor's shape geometry. The real ones live in
// --- the Shape Builder component; injecting them is what lets this module be
// --- tested without mounting React.

// Samples a shape's outline. Test shapes carry explicit points.
const getSampledPoints = (shape) => (shape.points || []).map((p) => ({ ...p }));

// Simulates the editor's density resample by halving every segment.
const resampleShapeBySpacing = (shape, spacing) => {
  if (!(spacing > 0)) return shape;
  const pts = shape.points || [];
  if (pts.length < 2) return shape;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(pts[i]);
    out.push({ x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2, color: pts[i].color });
  }
  out.push(pts[pts.length - 1]);
  return { ...shape, points: out };
};

// Scales about an explicit pivot so the group-transform assertions are exact.
const applyTransformations = (pts, shape) => {
  const sx = shape.scaleX ?? 1;
  const sy = shape.scaleY ?? 1;
  const px = shape.pivotX ?? 0;
  const py = shape.pivotY ?? 0;
  if (sx === 1 && sy === 1) return pts;
  return pts.map((p) => ({ ...p, x: px + (p.x - px) * sx, y: py + (p.y - py) * sy }));
};

const applyEffectToPoints = (pts) => ({ points: pts });

const build = (shapes, opts = {}) => buildFrameProgram(shapes, {
  getSampledPoints,
  resampleShapeBySpacing,
  applyTransformations,
  applyEffectToPoints,
  ...opts,
});

const line = (n, y = 0) => ({
  type: 'polyline',
  color: '#ff0000',
  points: Array.from({ length: n }, (_, i) => ({ x: i * 10, y })),
});

const sq = (o = 0) => ({
  type: 'rect',
  color: '#00ff00',
  points: [
    { x: o, y: o }, { x: o + 100, y: o }, { x: o + 100, y: o + 100 }, { x: o, y: o + 100 },
  ],
});

const extentX = (pts) => [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];

describe('effectiveSpacingFor', () => {
  it('honours an explicit user density', () => {
    expect(effectiveSpacingFor({ renderMode: 'simple' }, 3)).toBe(3);
    expect(effectiveSpacingFor({ renderMode: 'dotted' }, 12)).toBe(12);
  });

  it('auto-densifies only the per-point beam styles', () => {
    expect(effectiveSpacingFor({ renderMode: 'simple' }, 0)).toBe(0);
    expect(effectiveSpacingFor({ renderMode: 'dotted' }, 0)).toBe(BEAM_AUTO_SPACING);
    expect(effectiveSpacingFor({ renderMode: 'dashed' }, 0)).toBe(BEAM_AUTO_SPACING);
    expect(effectiveSpacingFor({ renderMode: 'points' }, 0)).toBe(BEAM_AUTO_SPACING);
    expect(effectiveSpacingFor({}, 0)).toBe(0);
    expect(effectiveSpacingFor(null, 0)).toBe(0);
  });
});

describe('toIldaPoint', () => {
  it('maps editor pixels to ILDA -1..1 with y flipped', () => {
    expect(toIldaPoint({ x: 500, y: 500 })).toEqual({ x: 0, y: 0 });
    expect(toIldaPoint({ x: 1000, y: 0 })).toEqual({ x: 1, y: 1 });
    expect(toIldaPoint({ x: 0, y: 1000 })).toEqual({ x: -1, y: -1 });
  });
});

describe('buildFrameProgram', () => {
  it('emits a solid outline in editor coordinates', () => {
    const { points } = build([sq()]);
    expect(points.length).toBe(5); // 4 corners + the closing vertex
    expect(points[0]).toMatchObject({ x: 0, y: 0, blanking: false });
    expect(points[4]).toMatchObject({ x: 0, y: 0 });
  });

  it('tolerates tombstoned (null) shape slots', () => {
    const { points, entries } = build([null, line(5), undefined, sq()]);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toBeNull();
    expect(entries[2]).toBeNull();
    expect(points.length).toBeGreaterThan(0);
  });

  it('skips hidden shapes so they never burn', () => {
    const { points, entries } = build([{ ...line(5), hidden: true }, line(5, 200)]);
    expect(entries[0]).toBeNull();
    // Only the visible shape contributes.
    expect(entries[1]).not.toBeNull();
    expect(extentX(points)).toEqual([0, 40]);
  });

  it('lifts the beam before starting a second shape', () => {
    const { points } = build([line(5), line(5, 200)]);
    // The lift lands ON the new shape's first position, so find the first point
    // the beam actually draws there.
    const secondStart = points.findIndex((p) => p.y === 200 && !p.blanking);
    expect(secondStart).toBeGreaterThan(0);
    // The point before it must be blanked, otherwise the beam drags a live
    // line across the canvas from the first shape into the second.
    expect(points[secondStart - 1].blanking).toBe(true);
  });

  it('does not waste a leading blank on the first shape in a frame', () => {
    const { points } = build([line(6)]);
    expect(points[0].blanking).toBe(false);
  });

  // --- Groups -------------------------------------------------------------

  it('applies the group scale to every child outline', () => {
    const group = { type: 'group', scaleX: 2, pivotX: 0, pivotY: 0, shapes: [sq(0), sq(200)] };
    const { points, entries } = build([group]);
    expect(entries[0].type).toBe('group');
    expect(entries[0].children).toHaveLength(2);
    const [minX, maxX] = extentX(points);
    // Child 1 spans 0..100 -> 0..200, child 2 spans 200..300 -> 400..600.
    expect(minX).toBe(0);
    expect(maxX).toBe(600);
  });

  it('lifts the beam between group children and before the group', () => {
    const group = { type: 'group', scaleX: 1, shapes: [line(4, 0), line(4, 200)] };
    const { points } = build([line(4, 400), group]);
    // The lift lands ON the child's first position, so look for the first
    // point the beam actually draws.
    const firstChildY = points.findIndex((p) => p.y === 0 && !p.blanking);
    const secondChildY = points.findIndex((p) => p.y === 200 && !p.blanking);
    expect(points[firstChildY - 1].blanking).toBe(true);
    expect(points[secondChildY - 1].blanking).toBe(true);
  });

  it('gives a group child its own beam entry, aligned with the child index', () => {
    const group = {
      type: 'group',
      shapes: [{ ...line(4, 0), renderMode: 'dashed' }, { ...line(4, 200), renderMode: 'points' }],
    };
    const { entries } = build([group]);
    expect(entries[0].children[0].mode).toBe('dashed');
    expect(entries[0].children[1].mode).toBe('points');
  });

  // --- Budget -------------------------------------------------------------

  it('charges the budget in sampled points, not emitted points', () => {
    // A dotted shape emits outline + a 20-point dwell per dot, so charging the
    // emitted length would consume the whole frame and starve later shapes.
    const allowance = Math.floor(40 / 2) - 2; // 18
    const { remaining, entries } = build([{ ...line(6), renderMode: 'dotted' }], { budget: 40 });
    expect(entries[0].emitted).toBeGreaterThan(entries[0].sampled);
    // The charge is the sampled outline plus this shape's lift point.
    expect(remaining).toBe(allowance - entries[0].sampled - 1);
    // Under the old emitted-point accounting this was driven to 0.
    expect(remaining).toBeGreaterThan(0);
  });

  it('leaves budget for later shapes instead of starving them', () => {
    const { entries, remaining } = build(
      [{ ...line(40), renderMode: 'dotted' }, { ...line(40, 300), renderMode: 'dotted' }],
      { budget: 120 },
    );
    expect(entries[1]).not.toBeNull();
    expect(entries[1].sampled).toBeGreaterThan(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it('reports the pattern it settled on so the preview can match it', () => {
    const { entries } = build([{ ...line(40), renderMode: 'dashed' }]);
    expect(entries[0].stats.dashLength).toBeGreaterThan(0);
    expect(entries[0].stats.gapLength).toBeGreaterThan(0);
    expect(entries[0].closed).toBe(false);
  });

  it('keeps an unsampled solid shape sparse', () => {
    const { entries } = build([sq()]);
    // 4 corners, not resampled: the point-density optimizer may not inflate it.
    expect(entries[0].sampled).toBeLessThanOrEqual(5);
  });

  // --- Effects ------------------------------------------------------------

  it('bakes an effect into the outline when asked', () => {
    let calls = 0;
    const spy = (pts, effect, pos) => {
      calls++;
      return { points: pts.map((p) => ({ ...p, y: p.y + 1000 * pos })) };
    };
    const effect = { type: 'wave' };
    const off = build([line(5)], { effect, bakeEffects: true, effectPos: 0, applyEffectToPoints: spy });
    expect(calls).toBe(1);
    expect(off.points[0].y).toBe(0);

    const on = build([line(5)], { effect, bakeEffects: false, effectPos: 1, applyEffectToPoints: spy });
    expect(on.points[0].y).toBe(0);
  });

  it('defaults to the shared point budget', () => {
    const { remaining } = build([line(6)]);
    expect(remaining).toBeLessThanOrEqual(Math.floor(DEFAULT_POINT_BUDGET / 2) - 2);
  });

  it('requires an injected geometry function', () => {
    expect(() => buildFrameProgram([line(5)], {})).toThrow(/getSampledPoints/);
  });

  it('emits dots for the points style and none for solid', () => {
    const dotted = build([{ ...line(30), renderMode: 'points' }], { budget: 2000 });
    const solid = build([line(30)], { budget: 2000 });
    expect(dotted.points.length).toBeGreaterThan(solid.points.length);
    // Points mode never draws a live segment: it moves with the beam off.
    const liveSegments = dotted.points.filter((p) => !p.blanking).length;
    expect(liveSegments).toBeGreaterThan(0);
    expect(dotted.points[0].blanking).toBe(true);
  });

  it('dwell keeps a dot visible without changing its position', () => {
    const { points } = build([{ ...line(30), renderMode: 'points' }], { budget: 4000 });
    const first = points[0];
    const dwellRun = points.slice(1, 1 + DEFAULT_DWELL);
    expect(dwellRun.every((p) => p.x === first.x && p.y === first.y)).toBe(true);
  });

  it('defaults the dot pitch when the user set no density', () => {
    const { entries } = build([{ ...line(30), renderMode: 'dotted' }], { budget: 4000 });
    expect(entries[0].stats.pitch).toBe(BEAM_AUTO_SPACING || DEFAULT_DOT_PITCH);
  });
});
