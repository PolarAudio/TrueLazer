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

  it('should have blanked transitions between frames in frame mode', () => {
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
    
    // Points expected:
    // [0]: (1,1) - Frame 2
    // [1]: (1,1) - Bridge (blanked)
    // [2]: (0,0) - Frame 1
    
    // The transition from [1] to [2] must be blanked to avoid a connecting line.
    // In laser terminology, the blanking bit on point [2] must be 1.
    expect(result.points[2 * 8 + 6]).toBe(1); // Point [2] (Frame 1 start) should be blanked
  });

  it('should bypass segment delay if point count is below 5', () => {
    const effectStates = new Map();
    const effects = [{
      id: 'delay',
      instanceId: 'd1',
      params: { mode: 'segment', delayAmount: 1, steps: 2, decay: 1.0, delayDirection: 'left_to_right' }
    }];

    // 1. Initial Frame (at 0,0) - 4 points
    const f0 = mockFrame([
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
    ]);
    applyEffects(f0, effects, { effectStates });

    // 2. Next Frame (at 1,1) - 4 points
    const f1 = mockFrame([
        { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }
    ]);
    
    // With 4 points, it should bypass. So result should have (1,1) points.
    // If it DOESN'T bypass, it would have some points from f0 (0,0) due to segment logic.
    const result = applyEffects(f1, effects, { effectStates });
    
    expect(result.points[0]).toBe(1); // Point 0 from f1
    expect(result.points[2 * 8]).toBe(1); // Point 2 should ALSO be from f1 if bypassed. If not bypassed, it would be from f0 (0).
  });

  it('should not throw for frames larger than the initial processing buffer (1024 pts)', () => {
    const effectStates = new Map();
    const effects = [{
      id: 'delay',
      instanceId: 'd1',
      params: { mode: 'segment', delayAmount: 2, steps: 3, decay: 0.8, delayDirection: 'left_to_right' }
    }];

    // 2000-point frame (> default 1024-point processing buffer)
    const points = [];
    for (let i = 0; i < 2000; i++) {
      points.push({ x: (i / 2000) * 2 - 1, y: Math.sin(i / 50) });
    }
    const frame = mockFrame(points);

    expect(() => applyEffects(frame, effects, { effectStates })).not.toThrow();
    const result = applyEffects(frame, effects, { effectStates });
    expect(result.points.length / 8).toBe(2000);
  });
});

describe('applyChase', () => {
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

  it('should keep exactly one point per segment step in segment mode', () => {
    const frame = mockFrame([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    const effects = [{
      id: 'chase',
      instanceId: 'c1',
      params: { mode: 'segment', steps: 4, decay: 0.8, speed: 1, overlap: 1, direction: 'left_to_right' }
    }];

    const result = applyEffects(frame, effects, { progress: 0, time: 0, syncSettings: {} });
    // Segment mode preserves point count
    expect(result.points.length / 8).toBe(4);
  });

  it('should not throw for frames larger than the initial processing buffer (1024 pts)', () => {
    const effects = [{
      id: 'chase',
      instanceId: 'c1',
      params: { mode: 'segment', steps: 4, decay: 0.8, speed: 1, overlap: 1, direction: 'left_to_right' }
    }];

    const points = [];
    for (let i = 0; i < 2000; i++) {
      points.push({ x: (i / 2000) * 2 - 1, y: Math.sin(i / 50) });
    }
    const frame = mockFrame(points);

    expect(() => applyEffects(frame, effects, { progress: 0.5, time: 100, syncSettings: {} })).not.toThrow();
    const result = applyEffects(frame, effects, { progress: 0.5, time: 100, syncSettings: {} });
    expect(result.points.length / 8).toBe(2000);
  });
});

describe('applyDelay channel mode regression', () => {
  const mockFrame = (points) => ({
    points: new Float32Array(points.flatMap(p => [p.x, p.y, 0, 255, 255, 255, 0, 0])),
    isTypedArray: true
  });

  it('should insert blanked bridge points between each per-channel echo', () => {
    const effectStates = new Map();
    const effects = [{
      id: 'delay',
      instanceId: 'dch',
      params: { mode: 'channel', delayAmount: 1, decay: 1.0, delayDirection: 'left_to_right' }
    }];
    const frame = mockFrame([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0.5, y: 0 }]);
    const context = { effectStates, assignedDacs: ['a', 'b', 'c'] };

    for (let i = 0; i < 3; i++) {
      applyEffects(frame, effects, context);
    }
    const result = applyEffects(frame, effects, context);
    const buf = result.points;

    // 3 echoes of 4 points each + 2 blanked bridge points = 14 points
    expect(buf.length / 8).toBe(14);

    // Distributions: one 4-point slice per DAC. The blanked bridge points sit
    // between echoes, so slice starts skip over them (0, 40, 80) — each slice is
    // exactly the 4-point echo, never overlapping the next.
    const dists = buf._channelDistributions;
    expect(dists.size).toBe(3);
    expect(dists.get(0)).toEqual({ start: 0, length: 32 });
    expect(dists.get(1)).toEqual({ start: 40, length: 32 });
    expect(dists.get(2)).toEqual({ start: 80, length: 32 });

    // Bridge points (after echo 0 and echo 1) must be blanked
    for (const idx of [4, 9]) {
      expect(buf[idx * 8 + 6]).toBe(1); // blanking flag
      expect(buf[idx * 8 + 3]).toBe(0); // zeroed color
    }
  });

  it('should keep per-channel routing when a default (none) mirror follows the delay', () => {
    const effectStates = new Map();
    const effects = [{
      id: 'delay',
      instanceId: 'dch',
      params: { mode: 'channel', delayAmount: 1, decay: 1.0, delayDirection: 'left_to_right' }
    }, {
      id: 'mirror',
      params: { mode: 'none', additive: true, axisOffset: 0, planeRotation: 0 }
    }];
    const frame = mockFrame([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0.5, y: 0 }]);
    const context = { effectStates, assignedDacs: ['a', 'b'] };

    for (let i = 0; i < 3; i++) {
      applyEffects(frame, effects, context);
    }
    const result = applyEffects(frame, effects, context);

    // Mirror 'none' must not strip the per-channel map — otherwise every DAC gets
    // the whole concatenated frame ("all channels turn on").
    expect(result.points._channelDistributions).toBeDefined();
    expect(result.points._channelDistributions.size).toBe(2);
  });

  it('should not throw when delayAmount comes from a binding outside the slider range', () => {
    const effectStates = new Map();
    const effects = [{
      id: 'delay',
      instanceId: 'dch',
      params: { mode: 'channel', delayAmount: 1e10, steps: 10, decay: 0.8, delayDirection: 'left_to_right' }
    }];
    const frame = mockFrame([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 }]);
    const context = { effectStates, assignedDacs: ['a', 'b'] };

    // Previously: history.length = delayAmount * numEchoes + 1 → RangeError on
    // oversized values. Must degrade gracefully for all three modes.
    for (const mode of ['segment', 'frame', 'channel']) {
      const m = new Map();
      expect(() => applyEffects(frame, [{ id: 'delay', instanceId: 'd1', params: { ...effects[0].params, mode } }],
        { effectStates: m, assignedDacs: ['a', 'b'] })).not.toThrow();
    }
  });

  it('should chase-modulate existing channel slices instead of duplicating the delay output', () => {
    const effectStates = new Map();
    const effects = [
      { id: 'delay', instanceId: 'd1', params: { mode: 'channel', delayAmount: 1, decay: 1.0, delayDirection: 'left_to_right' } },
      { id: 'chase', instanceId: 'c1', params: { mode: 'channel', steps: 2, decay: 0.8, speed: 1, overlap: 1, direction: 'left_to_right' } }
    ];
    const frame = mockFrame([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0.5, y: 0 }]);
    const context = { effectStates, assignedDacs: ['a', 'b'], progress: 0.5, time: 100, syncSettings: {} };

    for (let i = 0; i < 3; i++) applyEffects(frame, effects, context);
    const result = applyEffects(frame, effects, context);
    const buf = result.points;

    // Delay produced 2 echoes (4 pts each) + 1 bridge = 9 pts. Chase must NOT
    // re-duplicate the concatenated buffer per channel (that was the "double
    // delay" bug — every channel carrying every other channel's echoes).
    expect(buf.length / 8).toBe(9);
    expect(buf._channelDistributions.size).toBe(2);
    expect(buf._channelDistributions.get(0)).toEqual({ start: 0, length: 32 });
    expect(buf._channelDistributions.get(1)).toEqual({ start: 40, length: 32 });

    // progress 0.5 → t = 1 → dac0 (step 0) fully dimmed, dac1 (step 1) fully lit.
    expect(buf[0 + 6]).toBe(1);   // dac0 slice blanked by chase
    expect(buf[0 + 3]).toBe(0);   // dac0 slice RGB zeroed
    expect(buf[40 + 6]).toBe(0);  // dac1 slice stays lit
    expect(buf[40 + 3]).toBe(255);
  });

  it('should resolve custom channel order by ip:channel identity, not saved index', () => {
    const effectStates = new Map();
    const effects = [{
      id: 'delay',
      instanceId: 'dco',
      params: { mode: 'channel', useCustomOrder: true, delayAmount: 1, decay: 1.0, customOrder: [
        { ip: 'A', channel: 0, originalIndex: 0 },
        { ip: 'B', channel: 0, originalIndex: 1 }
      ] }
    }];
    const frame = mockFrame([{ x: 1, y: 0 }, { x: 0, y: 0 }]);

    // The clip's channel list was reordered AFTER the custom order was saved —
    // B now sits at index 0. An order keyed by the stale originalIndex would
    // route A's step to B (and vice-versa); identity matching must keep A first.
    const context = {
      effectStates,
      assignedDacs: [
        { ip: 'B', channel: 0, hostName: 'B' },
        { ip: 'A', channel: 0, hostName: 'A' },
        { ip: 'C', channel: 0, hostName: 'C' }
      ]
    };

    for (let i = 0; i < 3; i++) applyEffects(frame, effects, context);
    const result = applyEffects(frame, effects, context);
    const dists = result.points._channelDistributions;

    // Step 0 (echo offset 0) must be A (dac index 1), step 1 must be B (dac index 0).
    expect(dists.get(1).start).toBe(0);
    expect(dists.get(0).start).toBeGreaterThan(0);
    // C, which was not part of the saved order, trails behind the known channels.
    expect(dists.get(2).start).toBeGreaterThan(dists.get(0).start);
  });
});

describe('applyWarp (gravitational)', () => {
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

  it('should pull points toward the warp center with positive strength', () => {
    const frame = mockFrame([{ x: 0.5, y: 0.5 }]);
    const effects = [{
      id: 'warp',
      params: { amount: 0.5, posX: 0, posY: 0, radius: 1.0, decay: 2 }
    }];
    const result = applyEffects(frame, effects);
    const pts = getPoints(result);
    expect(pts[0].x).toBeLessThan(0.5);
    expect(pts[0].y).toBeLessThan(0.5);
    expect(pts[0].x).toBeGreaterThan(0);
  });

  it('should push points away from the warp center with negative strength', () => {
    const frame = mockFrame([{ x: 0.2, y: 0.2 }]);
    const effects = [{
      id: 'warp',
      params: { amount: -0.5, posX: 0, posY: 0, radius: 1.0, decay: 2 }
    }];
    const result = applyEffects(frame, effects);
    const pts = getPoints(result);
    expect(pts[0].x).toBeGreaterThan(0.2);
    expect(pts[0].y).toBeGreaterThan(0.2);
  });

  it('should leave points outside the radius untouched', () => {
    const frame = mockFrame([{ x: 0.9, y: 0.9 }]);
    const effects = [{
      id: 'warp',
      params: { amount: 2.0, posX: 0, posY: 0, radius: 0.5, decay: 2 }
    }];
    const result = applyEffects(frame, effects);
    const pts = getPoints(result);
    expect(pts[0].x).toBeCloseTo(0.9);
    expect(pts[0].y).toBeCloseTo(0.9);
  });

  it('should be time-independent (no animation over time)', () => {
    const frame = mockFrame([{ x: 0.4, y: 0.1, }, { x: 0.2, y: 0.3 }]);
    const effects = [{
      id: 'warp',
      params: { amount: 0.4, posX: 0, posY: 0, radius: 1.0, decay: 2 }
    }];
    const t1 = getPoints(applyEffects(frame, effects, { time: 0 }));
    const t2 = getPoints(applyEffects(frame, effects, { time: 5000 }));
    expect(t1).toEqual(t2);
  });

  it('should respect the warp position to influence different regions', () => {
    const frame = mockFrame([{ x: 0.1, y: 0.1 }]);
    const near = getPoints(applyEffects(frame, [{ id: 'warp', params: { amount: 0.5, posX: 0.1, posY: 0.1, radius: 0.5, decay: 2 } }]));
    const far = getPoints(applyEffects(frame, [{ id: 'warp', params: { amount: 0.5, posX: -0.1, posY: -0.1, radius: 0.5, decay: 2 } }]));
    expect(near[0].x).toBeCloseTo(0.1);
    expect(near[0].y).toBeCloseTo(0.1);
    expect(far[0].x).not.toBeCloseTo(0.1);
  });

  it('should mirror a speed-synced X onto a linked Y at runtime', () => {
    // fps sync at t=0 resolves posX to range[0] (-0.5). With linkXY on, posY
    // must use the SAME resolved value so the effect is symmetric.
    const makeFrame = () => mockFrame([{ x: 0.5, y: 0.1 }]);
    const effects = [{
      id: 'warp',
      instanceId: 'w',
      params: { amount: 0.5, posX: 0.3, posY: 0, radius: 1.5, decay: 1, linkXY: true },
    }];
    const syncSettings = { 'w.posX': { syncMode: 'fps', range: [-0.5, 0.5], speedMultiplier: 1 } };
    const context = { syncSettings, time: 0 };

    const linked = getPoints(applyEffects(makeFrame(), effects, context))[0];
    // Center (-0.5, -0.5): expected displacement toward it
    expect(linked.x).toBeCloseTo(0.4046, 2);
    expect(linked.y).toBeCloseTo(0.0428, 2);

    // Unlinked: posY stays at base 0, center becomes (-0.5, 0)
    const unlinkedEffects = [{
      id: 'warp',
      instanceId: 'w',
      params: { amount: 0.5, posX: 0.3, posY: 0, radius: 1.5, decay: 1, linkXY: false },
    }];
    const unlinked = getPoints(applyEffects(makeFrame(), unlinkedEffects, context))[0];
    expect(unlinked.x).toBeCloseTo(0.3358, 2);
    expect(unlinked.y).toBeCloseTo(0.0836, 2);
  });
});
