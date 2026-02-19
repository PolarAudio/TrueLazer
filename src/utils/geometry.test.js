import { describe, it, expect } from 'vitest';
import { calculateSmoothHandles } from './geometry';

describe('calculateSmoothHandles', () => {
  it('should return straight handles for only two points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ];
    const result = calculateSmoothHandles(points, false);
    // For 2 points, we expect P0, CP1, CP2, P1 where CPs are on the line
    expect(result.length).toBe(4);
    expect(result[0].x).toBe(0);
    expect(result[1].x).toBeCloseTo(33.333, 1);
    expect(result[2].x).toBeCloseTo(66.666, 1);
    expect(result[3].x).toBe(100);
  });

  it('should calculate curves for three points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 0 }
    ];
    const result = calculateSmoothHandles(points, false);
    // 2 segments, each with 4 points, but shared endpoints: P0, CP1, CP2, P1, CP3, CP4, P2
    // Total 7 points
    expect(result.length).toBe(7);
    // Midpoint should be P1
    expect(result[3].x).toBe(100);
    expect(result[3].y).toBe(100);
    // Handles around the midpoint should not be on the straight line to start/end
    expect(result[2].y).toBeGreaterThan(0);
    expect(result[4].y).toBeGreaterThan(0);
  });

  it('should handle closed loops correctly', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];
    const result = calculateSmoothHandles(points, true);
    // Closed loop with 4 points: 4 segments -> 4 * 3 + 1 = 13 points
    expect(result.length).toBe(13);
    // Last point should match first
    expect(result[12].x).toBe(0);
    expect(result[12].y).toBe(0);
  });
});
