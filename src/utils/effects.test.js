import { describe, it, expect } from 'vitest';
import { applyEffects } from './effects';

describe('applyMirror', () => {
  const mockFrame = (points) => ({
    points: new Float32Array(points.flatMap(p => [p.x, p.y, 0, 255, 255, 255, 0, 0])),
    isTypedArray: true
  });

  const getPoints = (frame) => {
    const pts = [];
    for (let i = 0; i < frame.points.length / 8; i++) {
      pts.push({ x: frame.points[i * 8], y: frame.points[i * 8 + 1] });
    }
    return pts;
  };

  it('should mirror with axisOffset on X', () => {
    const frame = mockFrame([{ x: 0.5, y: 0.5 }]);
    const effects = [{
      id: 'mirror',
      params: { mode: 'x+', axisOffset: 0.2, additive: true }
    }];
    
    const result = applyEffects(frame, effects);
    const pts = getPoints(result);
    
    // Original point at 0.5
    // Mirror axis at 0.2
    // Mirrored point should be at 2 * 0.2 - 0.5 = -0.1
    
    // Total points: 1 (original) + 1 (bridge) + 1 (mirrored) = 3
    expect(pts.length).toBe(3);
    expect(pts[0].x).toBeCloseTo(0.5);
    expect(pts[2].x).toBeCloseTo(-0.1);
  });

  it('should mirror with planeRotation', () => {
    const frame = mockFrame([{ x: 1, y: 0 }]);
    const effects = [{
      id: 'mirror',
      params: { mode: 'x+', planeRotation: 90, additive: true } // Rotate 90 deg makes it mirror Y
    }];
    
    const result = applyEffects(frame, effects);
    const pts = getPoints(result);
    
    // Original (1, 0)
    // Mode x+ rotated 90 deg -> behaves like y+
    // Mirrored across horizontal axis -> (1, 0) stays (1, 0) if mirroring across Y=0? 
    // Wait, if rotation is 90, the X axis becomes the Y axis.
    // Mirroring across what was X (now Y) means negating the new Y (old X).
    // So (1, 0) mirrored should be ( -1, 0 )? No, that's regular X mirroring.
    
    // Let's re-verify logic:
    // P = (1, 0). Rot -90: (0, -1). 
    // Mirror X (negate X): (0, -1).
    // Rot 90: (1, 0). 
    // Ah, if I rotate the plane by 90, it becomes horizontal. Mirroring X across a horizontal line?
    // Usually "Mirror X" means mirroring ACROSS a vertical line.
    // If I rotate that vertical line by 90 deg, it becomes a horizontal line.
    // Mirroring across a horizontal line negates Y.
    
    // P = (0, 1). Rot -90: (1, 0).
    // Mirror X (negate X): (-1, 0).
    // Rot 90: (0, -1).
    // Correct.
    
    const frame2 = mockFrame([{ x: 0, y: 1 }]);
    const result2 = applyEffects(frame2, effects);
    const pts2 = getPoints(result2);
    expect(pts2[2].y).toBeCloseTo(-1);
  });
});

describe('applyDelay', () => {
  const mockFrame = (points) => ({
    points: new Float32Array(points.flatMap(p => [p.x, p.y, 0, 255, 255, 255, 0, 0])),
    isTypedArray: true,
    instanceId: 'test-delay'
  });

  const getPoints = (frame) => {
    const pts = [];
    for (let i = 0; i < frame.points.length / 8; i++) {
      pts.push({ x: frame.points[i * 8], y: frame.points[i * 8 + 1] });
    }
    return pts;
  };

  it('should handle new frame mode by concatenating full history frames', () => {
    const effectStates = new Map();
    const effects = [{
      id: 'delay',
      instanceId: 'd1',
      params: { mode: 'frame', delayAmount: 1, steps: 2, decay: 1.0, delayDirection: 'left_to_right' }
    }];

    // Frame 1: Point at (0,0)
    const f1 = mockFrame([{ x: 0, y: 0 }]);
    applyEffects(f1, effects, { effectStates });

    // Frame 2: Point at (1,1)
    const f2 = mockFrame([{ x: 1, y: 1 }]);
    const result = applyEffects(f2, effects, { effectStates });
    const pts = getPoints(result);

    // In 'frame' mode with steps=2, output should be:
    // [Frame 2 point, Bridge, Frame 1 point]
    // Total 3 points
    
    expect(pts.length).toBe(3);
    expect(pts[0].x).toBeCloseTo(1);
    expect(pts[2].x).toBeCloseTo(0); 
  });
});
