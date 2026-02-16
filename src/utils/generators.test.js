import { describe, it, expect } from 'vitest';
import { generateTriangle } from './generators';

describe('generateTriangle', () => {
  it('should generate a triangle with the correct number of points', () => {
    const params = {
      width: 1,
      height: 1,
      pointDensity: 10,
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255
    };
    const result = generateTriangle(params);
    // 3 sides * 10 points per side + 1 closing point
    expect(result.points.length).toBe(31);
  });

  it('should apply correct coordinates based on width, height and position', () => {
    const params = {
      width: 2,
      height: 2,
      pointDensity: 1,
      x: 1,
      y: 1,
      r: 255,
      g: 255,
      b: 255
    };
    const result = generateTriangle(params);
    // Corners for width=2, height=2 at x=1, y=1:
    // Bottom-left: (-1+1, -1+1) = (0, 0)
    // Bottom-right: (1+1, -1+1) = (2, 0)
    // Top-center: (0+1, 1+1) = (1, 2)
    
    // With pointDensity=1, we get corners
    expect(result.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(result.points[1]).toMatchObject({ x: 2, y: 0 });
    expect(result.points[2]).toMatchObject({ x: 1, y: 2 });
    expect(result.points[3]).toMatchObject({ x: 0, y: 0 });
  });
});
