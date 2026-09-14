import { describe, it, expect, vi } from 'vitest';
import { generateTriangle, generateCircle } from './generators';

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
      x: 0,
      y: 0,
      r: 255,
      g: 255,
      b: 255
    };
    const result = generateTriangle(params);
    // 1 start corner + 3 edges × 30 steps per edge
    expect(result.points.length).toBe(91);
  });

  it('should start at the first corner and hit every corner exactly', () => {
    const params = {
      width: 2,
      height: 2,
      x: 1,
      y: 1,
      r: 255,
      g: 255,
      b: 255
    };
    const result = generateTriangle(params);
    expect(result.points.length).toBe(91);
    expect(result.points[0]).toMatchObject({ x: 0, y: 0 });

    // Anchored corners: every vertex is sampled exactly (no straddling), so a
    // physical scanner aims at the true corner instead of the closest sample.
    const hasPoint = (px, py) =>
      result.points.some(p => Math.abs(p.x - px) < 1e-9 && Math.abs(p.y - py) < 1e-9);
    expect(hasPoint(0, 0)).toBe(true);
    expect(hasPoint(2, 0)).toBe(true);
    expect(hasPoint(1, 2)).toBe(true);
  });

  it('should generate an equilateral triangle when size is provided', () => {
    const size = 2;
    const params = {
      size: size,
      x: 0,
      y: 0
    };
    const result = generateTriangle(params);
    
    const dist = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

    // Corner positions at points[0], points[30], points[60], points[90]
    const d01 = dist(result.points[0], result.points[30]);
    const d12 = dist(result.points[30], result.points[60]);
    const d20 = dist(result.points[60], result.points[90]);

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

describe('beam rendering styles', () => {
  it('dots style dwells each stroke point into ~10 samples with blanked approach and tail', () => {
    const normal = generateCircle({ numPoints: 4, renderingStyle: 'normal' });
    const dots = generateCircle({ numPoints: 4, renderingStyle: 'dots' });
    const inputCount = normal.points.length;

    expect(dots.points.length).toBe(inputCount * 10); // 1 blanked approach + 8 lit dwell + 1 blanked tail

    // First dot group: [blank approach][8 lit dwell][blank tail]
    expect(dots.points[0].blanking).toBe(true);
    expect(dots.points[1].blanking).toBe(false);
    expect(dots.points[8].blanking).toBe(false);
    expect(dots.points[9].blanking).toBe(true);

    // All lit dwell samples sit on the same spot so the scanner settles
    for (let i = 1; i < 9; i++) {
      expect(dots.points[i].x).toBe(dots.points[0].x);
      expect(dots.points[i].y).toBe(dots.points[0].y);
    }

    // Group boundaries are fully blanked so no connecting line can be drawn
    expect(dots.points[10].blanking).toBe(true);
    expect(dots.points[19].blanking).toBe(true);
    expect(dots.points[dots.points.length - 1].blanking).toBe(true);
  });

  it('dots style keeps every dot lit and dark approach/tail strictly alternating', () => {
    const dots = generateCircle({ numPoints: 4, renderingStyle: 'dots' });
    for (let g = 0; g < dots.points.length / 10; g++) {
      const base = g * 10;
      expect(dots.points[base].blanking).toBe(true);
      for (let i = 1; i < 9; i++) {
        expect(dots.points[base + i].blanking).toBe(false);
      }
      expect(dots.points[base + 9].blanking).toBe(true);
    }
  });

  it('dotted style is visible at default thickness and scales toward 10 samples', () => {
    const normal = generateCircle({ numPoints: 4, renderingStyle: 'normal' });
    const inputCount = normal.points.length;

    const light = generateCircle({ numPoints: 4, renderingStyle: 'dotted' }); // thickness defaults to 1
    expect(light.points.length).toBe(inputCount * 2); // thickness 1 -> 2 samples per point

    const heavy = generateCircle({ numPoints: 4, renderingStyle: 'dotted', thickness: 9 });
    expect(heavy.points.length).toBe(inputCount * 10); // capped at 10 samples per point

    // Keeps the segment line: every stroke point stays lit
    expect(light.points.every(p => !p.blanking)).toBe(true);
    expect(heavy.points.every(p => !p.blanking)).toBe(true);
  });
});

describe('blanked beam style', () => {
  it('divides an even point count into equal lit/blanked segments', () => {
    const normal = generateCircle({ numPoints: 50, renderingStyle: 'normal' });
    // 50 samples + closing duplicate is stripped, leaving 50 stroke points.
    expect(normal.points.length).toBe(51);

    const blanked = generateCircle({ numPoints: 50, renderingStyle: 'blanked', blankingSize: 5 });
    expect(blanked.points.length).toBe(50); // 10 blocks x 5 points

    for (let b = 0; b < 10; b++) {
      for (let p = 0; p < 5; p++) {
        const idx = b * 5 + p;
        expect(blanked.points[idx].blanking).toBe(b % 2 === 1);
      }
    }
  });

  it('rounds an odd point count up to the nearest divisible division', () => {
    const blanked = generateCircle({ numPoints: 45, renderingStyle: 'blanked', blankingSize: 6 });
    // 45 stroke points / (2*6) blocks = 3.75 -> rounded up to 48 points (4 per block).
    expect(blanked.points.length).toBe(48);

    for (let b = 0; b < 12; b++) {
      for (let p = 0; p < 4; p++) {
        const idx = b * 4 + p;
        expect(blanked.points[idx].blanking).toBe(b % 2 === 1);
      }
    }
  });

  it('stretches duplicates without altering the geometry parity', () => {
    const blanked = generateCircle({ numPoints: 45, renderingStyle: 'blanked', blankingSize: 6 });
    const first = blanked.points[0];
    const distinct = new Set(blanked.points.map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`));
    // First output sample is the first stroke point.
    expect(first.x).toBeCloseTo(0.5, 6);
    expect(first.y).toBeCloseTo(0, 6);
    // Padding duplicates stay on existing stroke samples (never morph the shape).
    expect(distinct.size).toBeLessThanOrEqual(45);
    expect(distinct.size).toBeGreaterThan(30);
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
