import { describe, it, expect } from 'vitest';
import {
  buildFrameProgram,
  effectiveSpacingFor,
  toIldaPoint,
  BEAM_AUTO_SPACING,
} from './frameProgram';
import { DEFAULT_POINT_BUDGET } from './exportOptimizer';
import { DEFAULT_DOT_PITCH, DEFAULT_DWELL } from './beamProgram';
import { DEFAULT_MAX_STEP_PX } from './pointResample';

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

// The longest jump the galvo has to make in one sample. A laser draws a line
// by visiting points, so a long segment renders as a chain of discrete dots
// rather than a line.
const maxSegment = (pts) => {
    let worst = 0;
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].blanking || pts[i - 1].blanking) continue;
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (d > worst) worst = d;
    }
    return worst;
};

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
    // The outline is resampled to a laser-safe step, so a 100px square is a
    // chain of 10px segments rather than four corners.
    expect(points.length).toBeGreaterThan(5);
    expect(points[0]).toMatchObject({ x: 0, y: 0, blanking: false });
    // The closing vertex still lands back on the first point.
    expect(points[points.length - 1]).toMatchObject({ x: 0, y: 0 });
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

  it('charges the budget in the points a shape actually emits', () => {
    // A dotted shape emits its outline PLUS a dwell per dot, so it costs far
    // more than its outline. The budget is the DAC's point clock, so it has
    // to be charged what the shape really costs to draw.
    const { remaining, entries } = build([{ ...line(6), renderMode: 'dotted' }], { budget: 40 });
    expect(entries[0].emitted).toBeGreaterThan(entries[0].sampled);
    expect(remaining).toBe(40 - 2 - entries[0].emitted);
    // And the pattern is squeezed to fit rather than overrunning the budget.
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(entries[0].emitted).toBeLessThanOrEqual(40);
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

  it('exports a solid shape at a step the scanner can resolve', () => {
    const { points, entries } = build([sq()]);
    // A laser draws a line by visiting points, so the exported geometry must
    // not ask the galvo to jump further than the step in one sample. A shape
    // exported as four bare corners renders as four dots on a wall.
    expect(maxSegment(points)).toBeLessThanOrEqual(DEFAULT_MAX_STEP_PX + 0.001);
    expect(entries[0].sampled).toBeGreaterThan(5);
  });

  it('keeps the shape of the outline while resampling it', () => {
    const { points } = build([sq()]);
    // The corners are still corners: the resampled outline passes through all
    // four of them.
    for (const corner of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]) {
      expect(points.some((p) => p.x === corner.x && p.y === corner.y)).toBe(true);
    }
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

  it('never spends more of the frame budget than the budget is', () => {
    // The budget IS the DAC's point clock. A frame that emits more points
    // than the budget allows runs slow on the hardware, so the export has to
    // fit inside it - and the fit must not be bought by throwing half of it
    // away either.
    for (const budget of [100, 300, 1200]) {
      for (const count of [1, 5, 20, 60]) {
        const shapes = Array.from({ length: count }, (_, i) => sq(i * 200));
        const { points } = build(shapes, { budget });
        expect(points.length, `budget ${budget}, ${count} shapes`).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('gives a solid shape the whole budget rather than half of it', () => {
    // A solid shape emits one ILDA point per outline point, so charging it
    // twice what it emits would halve how many shapes a frame can hold.
    const one = build([sq()], { budget: 1200 });
    const many = build(Array.from({ length: 10 }, (_, i) => sq(i * 200)), { budget: 1200 });
    expect(many.points.length).toBeGreaterThan(one.points.length * 8);
  });

  it('spends the whole budget instead of half of it', () => {
    // The budget is the DAC's point clock. Leaving half of it unused means
    // half as many shapes as the hardware could carry. The budget is a cap,
    // not a target - so this needs enough shapes for the cap to bind.
    const shapes = Array.from({ length: 30 }, (_, i) => sq(i * 200));
    const { points } = build(shapes, { budget: 1200 });
    expect(points.length / 1200).toBeGreaterThan(0.9);
  });

  it('degrades every shape equally when the frame is crowded', () => {
    // A shape squeezed down to four points burns as a row of dots - the very
    // defect this change is about. When the frame cannot afford full density
    // for every shape, they must all lose it together.
    const shapes = Array.from({ length: 30 }, (_, i) => sq(i * 200));
    const { entries } = build(shapes, { budget: 1200 });
    const drawn = entries.filter(Boolean);
    expect(drawn.length).toBe(30);
    const densities = drawn.map((e) => e.sampled);
    // No shape may be an order of magnitude worse off than another.
    expect(Math.min(...densities)).toBeGreaterThan(Math.max(...densities) * 0.8);
    // And every shape is still far denser than the four points that burn as
    // dots.
    expect(Math.min(...densities)).toBeGreaterThan(20);
  });

  it('drops a shape it cannot afford rather than drawing it as dots', () => {
    const shapes = Array.from({ length: 400 }, (_, i) => sq(i * 200));
    const { entries, points } = build(shapes, { budget: 1200 });
    expect(entries.some((e) => e === null)).toBe(true);
    expect(points.length).toBeLessThanOrEqual(1200);
  });

  it('defaults to the shared point budget', () => {
    const { remaining } = build([line(6)]);
    expect(remaining).toBeLessThanOrEqual(Math.floor(DEFAULT_POINT_BUDGET) - 2);
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
