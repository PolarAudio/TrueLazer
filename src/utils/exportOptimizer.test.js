import { describe, it, expect } from 'vitest';
import {
  detectCornerAnchors,
  decimateKeep,
  thinToTarget,
  optimizeShapePoints,
  createPointBudgetOptimizer,
  DEFAULT_POINT_BUDGET
} from './exportOptimizer';

const pt = (x, y) => ({ x, y });

describe('detectCornerAnchors', () => {
  it('flags a sharp 90° corner', () => {
    const pts = [pt(0, 0), pt(0, 10), pt(10, 10)];
    expect([...detectCornerAnchors(pts)]).toEqual([1]);
  });

  it('ignores collinear points', () => {
    const pts = [pt(0, 0), pt(2, 0), pt(5, 0), pt(9, 0)];
    expect(detectCornerAnchors(pts).size).toBe(0);
  });

  it('handles too-short arms (no anchor)', () => {
    const pts = [pt(0, 0), pt(0, 1), pt(1, 1)];
    expect(detectCornerAnchors(pts, { minArm: 5 }).size).toBe(0);
  });
});

describe('decimateKeep', () => {
  it('keeps both endpoints', () => {
    const pts = Array.from({ length: 50 }, (_, i) => pt(i, 0));
    const kept = decimateKeep(pts, new Set(), 1);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(49);
  });

  it('collapses a straight run but preserves a protected index', () => {
    const pts = [];
    for (let i = 0; i < 100; i++) pts.push(pt(i, 0));
    pts[50] = pt(50, 5); // the protected "anchor" bulge
    const kept = decimateKeep(pts, new Set([50]), 1);
    expect(kept).toContain(50);
    expect(kept.length).toBeLessThan(30);
  });

  it('allows a real deviation to survive on its own', () => {
    const pts = [];
    for (let i = 0; i < 100; i++) pts.push(pt(i, 0));
    pts[50] = pt(50, 30);
    const kept = decimateKeep(pts, new Set(), 2);
    expect(kept).toContain(50);
  });
});

describe('thinToTarget', () => {
  it('never drops the endpoints or protected points', () => {
    const pts = Array.from({ length: 100 }, (_, i) => pt(i, 0));
    const anchors = new Set([10, 42, 77]);
    const kept = thinToTarget(pts, anchors, 12);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(99);
    for (const a of anchors) expect(kept).toContain(a);
    expect(kept.length).toBeLessThanOrEqual(12);
    expect(kept.length).toBeGreaterThanOrEqual(5);
  });
});

describe('optimizeShapePoints', () => {
  it('is a no-op on fewer than 2 points', () => {
    const res = optimizeShapePoints([pt(1, 1)]);
    expect(res.points).toHaveLength(1);
    expect(res.indexes).toEqual([0]);
  });

  it('dramatically reduces a noisy straight line', () => {
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push(pt(i * 10, Math.sin(i) * 0.001));
    const res = optimizeShapePoints(pts, { relativeTol: 0.01 });
    expect(res.points.length).toBeLessThan(20);
    expect(res.points.length).toBeGreaterThanOrEqual(2);
  });

  it('respects targetCount and preserves corners', () => {
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push(pt(i, 0));
    pts[50] = pt(50, 40); // hard corner
    pts[100] = pt(100, 80);
    const res = optimizeShapePoints(pts, { targetCount: 6 });
    expect(res.points.length).toBeLessThanOrEqual(6);
    const keptIdx = res.indexes;
    expect(keptIdx).toContain(0);
    expect(keptIdx).toContain(199);
    expect(keptIdx).toContain(50);
    expect(keptIdx).toContain(100);
  });
});

describe('createPointBudgetOptimizer', () => {
  it('caps total sampled points across shapes to the budget', () => {
    const opt = createPointBudgetOptimizer({ budget: 400 });
    const ptsA = Array.from({ length: 1000 }, (_, i) => pt(i, 0));
    const ptsB = Array.from({ length: 1000 }, (_, i) => pt(i, 1));
    const a = opt.processShape(ptsA);
    opt.accountFor(a.indexes.length);
    const b = opt.processShape(ptsB);
    opt.accountFor(b.indexes.length);
    expect(a.indexes.length + b.indexes.length).toBeLessThanOrEqual(Math.floor(400 / 2) - 2 + 4);
    expect(DEFAULT_POINT_BUDGET).toBe(1200);
  });

  it('floors the point count to minPoints even when the budget says otherwise', () => {
    const opt = createPointBudgetOptimizer({ budget: 10 });
    const pts = [];
    for (let i = 0; i < 500; i++) pts.push(pt(i, Math.sin(i * 0.3) * 20));
    const res = opt.processShape(pts, { minPoints: 4 });
    expect(res.indexes.length).toBeGreaterThanOrEqual(4);
    expect(res.indexes.length).toBeLessThanOrEqual(4);
  });

  it('reports remaining budget', () => {
    const opt = createPointBudgetOptimizer({ budget: 120 });
    const pts = Array.from({ length: 100 }, (_, i) => pt(i, 0));
    const res = opt.processShape(pts);
    opt.accountFor(res.indexes.length);
    expect(opt.remaining).toBeLessThan(Math.floor(120 / 2) - 2);
  });
});

describe('optimizeShapePoints keepAll', () => {
  // A resampled outline is dense but collinear within each segment, so normal
  // decimation collapses it straight back to the sparse anchors — which undid an
  // explicit point-density request and left only the first segment exported.
  const densePolyline = (() => {
    const pts = [];
    const anchors = [[0, 0], [100, 200], [200, 0], [300, 200], [400, 0]];
    for (let s = 0; s < anchors.length - 1; s++) {
      const [ax, ay] = anchors[s];
      const [bx, by] = anchors[s + 1];
      const steps = 10;
      for (let i = 0; i < steps; i++) {
        pts.push(pt(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps));
      }
    }
    pts.push(pt(400, 0));
    return pts;
  })();

  it('keeps every resampled point instead of decimating back to the anchors', () => {
    const decimated = optimizeShapePoints(densePolyline, { detectCorners: true });
    expect(decimated.points.length).toBeLessThan(densePolyline.length);

    const kept = optimizeShapePoints(densePolyline, { keepAll: true });
    expect(kept.points.length).toBe(densePolyline.length);
    expect(kept.points[kept.points.length - 1]).toEqual(pt(400, 0));
  });

  it('survives the budget optimizer without losing the whole outline', () => {
    const opt = createPointBudgetOptimizer({ budget: 1200 });
    const res = opt.processShape(densePolyline, { keepAll: true, minPoints: 4 });
    expect(res.points.length).toBe(densePolyline.length);
    // The tail of the shape must still be present, not truncated to the head.
    const lastX = res.points[res.points.length - 1].x;
    expect(lastX).toBe(400);
  });

  it('thins evenly to the budget allowance while keeping both endpoints', () => {
    const opt = createPointBudgetOptimizer({ budget: 100 });
    const res = opt.processShape(densePolyline, { keepAll: true, minPoints: 4 });
    expect(res.points.length).toBeLessThanOrEqual(Math.floor(100 / 2) - 2);
    expect(res.points[0]).toEqual(pt(0, 0));
    expect(res.points[res.points.length - 1]).toEqual(pt(400, 0));
    // Even thinning spreads the kept points across the full extent.
    const xs = res.points.map(p => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(400, 5);
  });
});