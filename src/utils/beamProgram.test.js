import { describe, it, expect } from 'vitest';
import {
  measureOutline,
  pointAtDistance,
  dashRuns,
  pointsInRun,
  dotStations,
  buildBeamProgram,
  isClosedType,
  resolveDashRuns,
  resolveDotStations,
  defaultBeamPointAllowance,
  DEFAULT_DOT_PITCH,
} from './beamProgram';

const pt = (x, y, color) => (color ? { x, y, color } : { x, y });

// A 400x100 open polyline: three straight runs of 100, 200 and 100.
const zigzag = [pt(0, 0), pt(100, 100), pt(300, 100), pt(400, 0)];

describe('measureOutline', () => {
  it('sums the segment lengths for an open outline', () => {
    const m = measureOutline(zigzag, false);
    expect(m.total).toBeCloseTo(Math.hypot(100, 100) + 200 + Math.hypot(100, 100), 6);
  });

  it('includes the closing segment for a closed outline', () => {
    const open = measureOutline(zigzag, false).total;
    const closed = measureOutline(zigzag, true).total;
    expect(closed).toBeGreaterThan(open);
    expect(closed - open).toBeCloseTo(Math.hypot(400, 0), 6);
  });

  it('reports zero length for degenerate input', () => {
    expect(measureOutline([], false).total).toBe(0);
    expect(measureOutline([pt(5, 5)], false).total).toBe(0);
  });
});

describe('pointAtDistance', () => {
  const m = measureOutline([pt(0, 0), pt(100, 0), pt(100, 100)], false);

  it('interpolates along a segment', () => {
    expect(pointAtDistance(m, 50)).toMatchObject({ x: 50, y: 0 });
    expect(pointAtDistance(m, 150)).toMatchObject({ x: 100, y: 50 });
  });

  it('clamps to the ends', () => {
    expect(pointAtDistance(m, -10)).toMatchObject({ x: 0, y: 0 });
    expect(pointAtDistance(m, 9999)).toMatchObject({ x: 100, y: 100 });
  });

  it('wraps onto the closing segment of a closed outline', () => {
    const c = measureOutline([pt(0, 0), pt(100, 0), pt(100, 100)], true);
    // Outline: 100 across, 100 down, then 141.42 back to the origin.
    expect(c.total).toBeCloseTo(100 + 100 + Math.hypot(100, 100), 5);
    // Halfway along the closing diagonal lands on the diagonal's midpoint.
    const half = pointAtDistance(c, 200 + Math.hypot(100, 100) / 2);
    expect(half.x).toBeCloseTo(50, 5);
    expect(half.y).toBeCloseTo(50, 5);
    // A quarter of the way along it.
    const quarter = pointAtDistance(c, 200 + Math.hypot(100, 100) / 4);
    expect(quarter.x).toBeCloseTo(75, 5);
    expect(quarter.y).toBeCloseTo(75, 5);
  });
});

describe('dashRuns', () => {
  it('covers the outline with alternating on/off runs', () => {
    const m = measureOutline([pt(0, 0), pt(100, 0)], false);
    const runs = dashRuns(m, { dashLength: 30, gapLength: 20 });
    expect(runs[0]).toMatchObject({ from: 0, to: 30, blanked: false });
    expect(runs[1]).toMatchObject({ from: 30, to: 50, blanked: true });
    expect(runs[2].blanked).toBe(false);
    // No gaps in coverage, and it stops at the end of the outline.
    for (let i = 1; i < runs.length; i++) expect(runs[i].from).toBeCloseTo(runs[i - 1].to, 6);
    expect(runs[runs.length - 1].to).toBeCloseTo(100, 6);
  });

  it('is independent of how densely the outline is sampled', () => {
    // The same line sampled two ways must produce the same dash geometry —
    // this is what an index-based (i % 2) pattern got wrong.
    const coarse = measureOutline([pt(0, 0), pt(100, 0)], false);
    const dense = measureOutline(
      Array.from({ length: 101 }, (_, i) => pt(i, 0)),
      false,
    );
    const a = dashRuns(coarse, { dashLength: 16, gapLength: 10 });
    const b = dashRuns(dense, { dashLength: 16, gapLength: 10 });
    expect(b.length).toBe(a.length);
    a.forEach((r, i) => {
      expect(b[i].from).toBeCloseTo(r.from, 6);
      expect(b[i].to).toBeCloseTo(r.to, 6);
    });
  });

  it('emits no runs for a zero-length outline', () => {
    expect(dashRuns(measureOutline([pt(1, 1)], false), {})).toEqual([]);
  });
});

describe('pointsInRun', () => {
  it('keeps the run ends and the outline points inside the run', () => {
    const m = measureOutline([pt(0, 0), pt(50, 0), pt(100, 0)], false);
    const pts = pointsInRun(m, { from: 25, to: 75, blanked: false });
    expect(pts[0]).toMatchObject({ x: 25 });
    expect(pts[pts.length - 1]).toMatchObject({ x: 75 });
    // The middle outline vertex at x=50 is inside the run and must survive.
    expect(pts.some(p => p.x === 50)).toBe(true);
  });
});

describe('dotStations', () => {
  it('spaces stations evenly along the outline', () => {
    const m = measureOutline([pt(0, 0), pt(100, 0)], false);
    const st = dotStations(m, 25);
    expect(st.length).toBe(4);
    expect(st.map(s => s.x)).toEqual([0, 25, 50, 75]);
  });

  it('returns a single station for a zero-length outline', () => {
    expect(dotStations(measureOutline([pt(3, 3)], false), 10).length).toBe(1);
  });
});

describe('buildBeamProgram', () => {
  const outline = [pt(0, 0), pt(100, 0), pt(100, 100)];

  it('simple mode draws the outline unblanked', () => {
    const { points } = buildBeamProgram(outline, { mode: 'simple' });
    expect(points.length).toBe(3);
    expect(points.every(p => !p.blanking)).toBe(true);
  });

  it('simple mode closes a closed outline', () => {
    const { points } = buildBeamProgram(outline, { mode: 'simple', closed: true });
    expect(points.length).toBe(4);
    expect(points[3]).toMatchObject({ x: 0, y: 0 });
  });

  it('dotted mode draws the line AND dwells multiple points per dot', () => {
    const { points, stats } = buildBeamProgram(outline, { mode: 'dotted', pitch: 50, dwell: 8 });
    // 3 outline points + 2 stations * 8 dwell, plus the remainder station.
    const dwellPoints = points.filter(p => !p.blanking);
    expect(dwellPoints.length).toBeGreaterThan(outline.length);
    // A dot means several identical consecutive points.
    let maxRun = 1;
    let run = 1;
    for (let i = 1; i < points.length; i++) {
      if (points[i].x === points[i - 1].x && points[i].y === points[i - 1].y && !points[i].blanking) {
        run++;
        maxRun = Math.max(maxRun, run);
      } else run = 1;
    }
    expect(maxRun).toBeGreaterThanOrEqual(8);
    expect(stats.dots).toBeGreaterThan(1);
  });

  it('points mode emits dots only, joined by blanked moves', () => {
    const { points } = buildBeamProgram(outline, { mode: 'points', pitch: 50, dwell: 6 });
    const unblanked = points.filter(p => !p.blanking);
    const blanked = points.filter(p => p.blanking);
    expect(unblanked.length % 6).toBe(0);
    expect(blanked.length).toBe(unblanked.length / 6);
  });

  it('dashed mode blanks the gaps between dashes', () => {
    const { points } = buildBeamProgram(outline, { mode: 'dashed', dashLength: 30, gapLength: 20 });
    expect(points.some(p => p.blanking)).toBe(true);
    expect(points.some(p => !p.blanking)).toBe(true);
    // The first gap must actually be a gap in the geometry.
    const blanked = points.filter(p => p.blanking);
    expect(blanked[0].x).toBeCloseTo(30, 5);
  });

  it('dashed ink lands in the same place regardless of outline sampling', () => {
    const dense = Array.from({ length: 101 }, (_, i) => pt(i, 0));
    const a = buildBeamProgram([pt(0, 0), pt(100, 0)], { mode: 'dashed', dashLength: 16, gapLength: 10 });
    const b = buildBeamProgram(dense, { mode: 'dashed', dashLength: 16, gapLength: 10 });
    // The inked ranges must be identical; a denser outline only adds blanked
    // points inside the gaps (a smooth blanked travel instead of a jump).
    const ranges = (r) => {
      const out = [];
      let open = false;
      r.points.forEach((p) => {
        if (p.blanking) { open = false; return; }
        if (!open) { out.push([p.x, p.x]); open = true; }
        else out[out.length - 1][1] = p.x;
      });
      return out;
    };
    expect(ranges(b)).toEqual(ranges(a));
    expect(ranges(a).length).toBe(4);
    // More blanked travel points, but never more ink.
    expect(b.points.length).toBeGreaterThan(a.points.length);
  });

  it('stretches the dot pitch to stay inside the point budget', () => {
    const long = [pt(0, 0), pt(1000, 0)];
    const { points, stats } = buildBeamProgram(long, {
      mode: 'points', pitch: 2, dwell: 20, maxPoints: 200,
    });
    expect(points.length).toBeLessThanOrEqual(200);
    expect(stats.pitch).toBeGreaterThan(2);
    expect(stats.scaled).toBe(true);
  });

  it('stretches the dash pattern to stay inside the point budget', () => {
    const long = [pt(0, 0), pt(4000, 0)];
    const { points, stats } = buildBeamProgram(long, {
      mode: 'dashed', dashLength: 2, gapLength: 2, maxPoints: 60,
    });
    expect(points.length).toBeLessThanOrEqual(60);
    expect(stats.dashLength).toBeGreaterThan(2);
  });

  it('falls back to the shape colour when a point has none', () => {
    const { points } = buildBeamProgram([pt(0, 0), pt(10, 0)], {
      mode: 'simple', color: '#ff0000',
    });
    expect(points[0].color).toBe('#ff0000');
  });

  it('returns nothing for a degenerate outline', () => {
    expect(buildBeamProgram([], { mode: 'simple' }).points).toEqual([]);
    expect(buildBeamProgram([pt(1, 1)], { mode: 'dotted' }).points).toEqual([]);
  });
});

describe('isClosedType', () => {
  it('matches the closed primitives only', () => {
    ['polygon', 'rect', 'circle', 'star', 'triangle'].forEach(t => expect(isClosedType(t)).toBe(true));
    ['polyline', 'pen', 'bezier', 'line', 'group'].forEach(t => expect(isClosedType(t)).toBe(false));
  });
});

describe('DEFAULT_DOT_PITCH', () => {
  it('is a positive dot pitch', () => {
    expect(DEFAULT_DOT_PITCH).toBeGreaterThan(0);
  });
});

describe('budget-aware pattern resolution', () => {
  const long = [pt(0, 0), pt(4000, 0)];

  it('defaultBeamPointAllowance mirrors the export budget', () => {
    // exportOptimizer allows floor(budget/2) - 2 sampled points per shape.
    expect(defaultBeamPointAllowance(1200)).toBe(598);
    expect(defaultBeamPointAllowance(1200)).toBe(Math.max(8, Math.floor(1200 / 2) - 2));
  });

  it('leaves the pattern alone when it already fits', () => {
    const m = measureOutline([pt(0, 0), pt(100, 0)], false);
    const r = resolveDashRuns(m, { dashLength: 16, gapLength: 10, maxPoints: 1000 });
    expect(r.scaled).toBe(false);
    expect(r.dashLength).toBe(16);
  });

  it('stretches dash and gap together, preserving their ratio', () => {
    const m = measureOutline(long, false);
    const r = resolveDashRuns(m, { dashLength: 16, gapLength: 10, maxPoints: 80 });
    expect(r.scaled).toBe(true);
    expect(r.dashLength).toBeGreaterThan(16);
    expect(r.gapLength).toBeGreaterThan(10);
    expect(r.dashLength / r.gapLength).toBeCloseTo(16 / 10, 5);
  });

  it('keeps the inked dash count the same before and after stretching', () => {
    const m = measureOutline(long, false);
    const tight = resolveDashRuns(m, { dashLength: 16, gapLength: 10, maxPoints: 80 });
    const loose = resolveDashRuns(m, { dashLength: 16, gapLength: 10, maxPoints: 100000 });
    // Fewer, longer dashes — never a truncated outline.
    expect(tight.runs.filter(r => !r.blanked).length)
      .toBeLessThan(loose.runs.filter(r => !r.blanked).length);
    expect(tight.runs[tight.runs.length - 1].to).toBeCloseTo(m.total, 5);
  });

  it('stretches the dot pitch and keeps the pattern even', () => {
    const m = measureOutline(long, false);
    const r = resolveDotStations(m, { pitch: 2, dwell: 20, maxPoints: 300 });
    expect(r.scaled).toBe(true);
    expect(r.pitch).toBeGreaterThan(2);
    const gaps = r.stations.slice(1).map((s, i) => s.d - r.stations[i].d);
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread).toBeLessThan(1e-6);
  });

  it('the resolver and buildBeamProgram agree on the pattern', () => {
    const m = measureOutline(long, false);
    const opts = { pitch: 2, dwell: 20, maxPoints: 300 };
    const resolved = resolveDotStations(measureOutline(long, false), opts);
    const built = buildBeamProgram(long, { mode: 'points', ...opts });
    expect(built.stats.pitch).toBeCloseTo(resolved.pitch, 6);
    expect(built.stats.dots).toBe(resolved.stations.length);
  });
});

// A dotted shape draws its outline AND dwells on dots. The closing arc of a
// closed outline is covered by measureOutline's total length but has no vertex
// in the point list, so it has to be emitted explicitly or the loop is left open.
describe('buildBeamProgram dotted closure', () => {
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  const opts = { dwell: 2, pitch: 500 };

  it('emits the closing vertex for a closed outline', () => {
    const closed = buildBeamProgram(square, { mode: 'dotted', closed: true, ...opts });
    const open = buildBeamProgram(square, { mode: 'dotted', closed: false, ...opts });
    // One extra vertex closes the loop.
    expect(closed.points.length).toBe(open.points.length + 1);
    const last = closed.points[closed.points.length - 1];
    expect(last).toMatchObject({ x: 0, y: 0 });
  });

  it('does not close an open outline', () => {
    const open = buildBeamProgram(square, { mode: 'dotted', closed: false, ...opts });
    const last = open.points[open.points.length - 1];
    expect(last).toMatchObject({ x: 0, y: 100 });
  });
});
