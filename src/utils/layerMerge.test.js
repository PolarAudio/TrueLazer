import { describe, it, expect } from 'vitest';
import { mergeSourceFrames, MERGE_MODE, BLEND, trimTrailingBlanks, hasLitPoints } from './layerMerge';

// Flat 8-float buffer layout: x,y,z,r,g,b,blanking(0/1),lastPoint(0/1)
const flat = (pts) => {
  const arr = new Float32Array(pts.length * 8);
  pts.forEach((p, i) => {
    const o = i * 8;
    arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = 0;
    arr[o + 3] = p.r || 0; arr[o + 4] = p.g || 0; arr[o + 5] = p.b || 0;
    arr[o + 6] = p.blanking ? 1 : 0; arr[o + 7] = p.lastPoint ? 1 : 0;
  });
  arr[(pts.length - 1) * 8 + 7] = 1;
  return arr;
};

const clip = (pts, layerIndex = 0, blend = BLEND.NORMAL) => ({ points: flat(pts), layerIndex, blend });

describe('trimTrailingBlanks / hasLitPoints', () => {
  it('strips the padded hold tail, keeps content', () => {
    const src = flat([
      { x: 0, y: 0, r: 10, g: 10, b: 10 },
      { x: 1, y: 1, r: 10, g: 10, b: 10, blanking: true },
      { x: 1, y: 1, r: 0, g: 0, b: 0, blanking: true },
    ]);
    const trimmed = trimTrailingBlanks(src);
    expect(trimmed.length / 8).toBe(1);
    expect(trimmed[0]).toBe(0);
    expect(hasLitPoints(trimmed)).toBe(true);
    expect(hasLitPoints(flat([{ x: 0, y: 0, blanking: true }]))).toBe(false);
  });

  it('pads-back pattern: two budget-padded sources merge to a frame with lit points', () => {
    const padTo = (f, n) => {
      const out = new Float32Array(n * 8);
      out.set(f);
      for (let i = f.length / 8; i < n; i++) out[i * 8 + 6] = 1;
      return out;
    };
    const bg = padTo(flat([
      { x: 0.2, y: 0.2, r: 255, g: 255, b: 255 },
      { x: 0.35, y: 0.2, r: 255, g: 255, b: 255 },
      { x: 0.275, y: 0.275, r: 255, g: 255, b: 255 },
    ]), 20);
    const fg = padTo(flat([
      { x: -0.5, y: -0.5, r: 255, g: 0, b: 0 },
      { x: 0.5, y: -0.5, r: 255, g: 0, b: 0 },
      { x: 0, y: 0.5, r: 255, g: 0, b: 0 },
    ]), 20);
    const merged = mergeSourceFrames(
      [
        { points: trimTrailingBlanks(bg), layerIndex: 1, blend: BLEND.NORMAL },
        { points: trimTrailingBlanks(fg), layerIndex: 0, blend: BLEND.NORMAL },
      ],
      1000,
      MERGE_MODE.COMBINE,
    );
    expect(hasLitPoints(merged)).toBe(true);
  });
});

describe('mergeSourceFrames (two tracks → one DAC channel)', () => {
  it('passes a single source frame through untouched', () => {
    const src = clip([{ x: 0.5, y: 0.5, r: 255, g: 0, b: 0 }]);
    expect(mergeSourceFrames([src], 100)).toBe(src.points);
  });

  it('merges two sources: the lower layerIndex (on top) is kept over the covering shape', () => {
    // Background triangle (strictly inside the top shape) …
    const bg = clip([
      { x: 0.2, y: 0.2, r: 255, g: 255, b: 255 },
      { x: 0.35, y: 0.2, r: 255, g: 255, b: 255 },
      { x: 0.275, y: 0.275, r: 255, g: 255, b: 255, lastPoint: true },
    ], 1);
    // … on top of it (wave fading in over the chase).
    const top = clip([
      { x: 0, y: 0, r: 255, g: 0, b: 0 },
      { x: 1, y: 0, r: 255, g: 0, b: 0 },
      { x: 0, y: 1, r: 255, g: 0, b: 0, lastPoint: true },
    ], 0);

    const merged = mergeSourceFrames([bg, top], 1000, MERGE_MODE.OVERLAY);

    // The background shape sits inside the top shape → culled by the overlay.
    // Only the top shape's lit points survive, at the top's colour.
    expect(merged.length / 8).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i++) {
      expect(merged[i * 8]).toBeCloseTo(i === 0 ? 0 : (i === 1 ? 1 : 0));
      expect(merged[i * 8 + 1]).toBeCloseTo(i === 2 ? 1 : 0);
      expect(merged[i * 8 + 3]).toBeCloseTo(255);
      expect(merged[i * 8 + 4]).toBeCloseTo(0);
      expect(merged[i * 8 + 5]).toBeCloseTo(0);
    }
    // …and the frame is closed with a blanked return to the first point so
    // closed-frame hardware loops the composite at full brightness instead of
    // writing it once per frame.
    const n = merged.length / 8;
    expect(merged[0]).toBeCloseTo(merged[(n - 1) * 8]);
    expect(merged[1]).toBeCloseTo(merged[(n - 1) * 8 + 1]);
    for (let i = 3; i < n; i++) {
      expect(merged[i * 8 + 6]).toBe(1);
    }
    expect(merged[(n - 1) * 8 + 7]).toBe(1);
  });

  it('reduces the merged frame to the per-channel point budget', () => {
    const mk = (n, r, g, b) => Array.from({ length: n }, (_, i) => ({
      x: i, y: 0, r, g, b, lastPoint: i === n - 1,
    }));
    const bg = clip(mk(30, 255, 255, 255), 1);
    const top = clip(mk(30, 255, 0, 0), 0);
    const merged = mergeSourceFrames([bg, top], 10, MERGE_MODE.OVERLAY);
    // Lit points are capped at the per-channel budget (blanks are never culled,
    // and the closing blanked return adds no lit work).
    let lit = 0;
    for (let i = 0; i < merged.length / 8; i++) if (merged[i * 8 + 6] === 0) lit++;
    expect(lit).toBeLessThanOrEqual(10);
  });
});
