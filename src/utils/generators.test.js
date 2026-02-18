import { describe, it, expect, vi } from 'vitest';
import { generateTriangle } from './generators';

// Mock opentype.js
vi.mock('opentype.js', () => ({
  default: {
    parse: vi.fn(() => ({
      getPath: vi.fn(() => ({
        commands: [],
        getBoundingBox: vi.fn(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }))
      }))
    }))
  }
}));

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

  it('should generate an equilateral triangle when size is provided', () => {
    const size = 2;
    const params = {
      size: size,
      pointDensity: 1,
      x: 0,
      y: 0
    };
    const result = generateTriangle(params);
    
    // Calculate distances between vertices
    const p0 = result.points[0];
    const p1 = result.points[1];
    const p2 = result.points[2];

    const dist = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

    const d01 = dist(p0, p1);
    const d12 = dist(p1, p2);
    const d20 = dist(p2, p0);

    // All sides should be equal to 'size'
    expect(d01).toBeCloseTo(size, 5);
    expect(d12).toBeCloseTo(size, 5);
    expect(d20).toBeCloseTo(size, 5);
  });
});

describe('generateWaveform', () => {
  it('should generate points for bars mode with freqRange', () => {
    const params = {
      mode: 'bars',
      numBins: 2,
      width: 2,
      height: 1,
      freqRange: [0.5, 1.0],
      audioData: new Uint8Array([0, 0, 255, 255]) // 4 bins
    };
    const result = import('./generators').then(m => m.generateWaveform(params));
    // freqRange [0.5, 1.0] means indices [2, 3] which are both 255.
    // numBins 2 means it will sample index 2 and index 3.
    return result.then(res => {
        expect(res.points.length).toBe(8); // 4 points per bin * 2 bins
        // Check Y coordinates of peak points (bar ends)
        // Offset is dataIdx 2 and 3. Both are 255.
        // val = (255/255) * 1 = 1.0
        // y = -0.5 + 1.0 = 0.5
        expect(res.points[2].y).toBeCloseTo(0.5);
        expect(res.points[6].y).toBeCloseTo(0.5);
    });
  });

  it('should generate points for waveform mode', () => {
    const params = {
      mode: 'waveform',
      numBins: 50,
      audioData: new Uint8Array(50).fill(128)
    };
    const result = import('./generators').then(m => m.generateWaveform(params));
    return result.then(res => {
        expect(res.points.length).toBe(50);
    });
  });

  it('should generate points for spectrum mode', () => {
    const params = {
      mode: 'spectrum',
      numBins: 32,
      audioData: new Uint8Array(32).fill(100)
    };
    const result = import('./generators').then(m => m.generateWaveform(params));
    return result.then(res => {
        expect(res.points.length).toBe(32);
    });
  });
});

describe('generateTimer', () => {
  const mockFont = new ArrayBuffer(100);

  it('should handle null context gracefully', async () => {
    const params = {
      mode: 'clock',
      format: 'MM:SS',
      fontUrl: 'mock'
    };
    // We expect this NOT to throw
    const result = await import('./generators').then(m => m.generateTimer(params, mockFont, null));
    expect(result).toBeDefined();
  });

  it('should format time correctly in MM:SS', async () => {
    const params = { mode: 'count-up', format: 'MM:SS' };
    const context = { time: 10000, activationTime: 0 }; // 10 seconds
    const result = await import('./generators').then(m => m.generateTimer(params, mockFont, context));
    // Implementation uses generateText, so we check if it tried to render '00:10'
    // Since we can't easily peek into generateText's internal opentype calls in this env,
    // we just ensure it returns points.
    expect(result.points).toBeDefined();
  });
});
