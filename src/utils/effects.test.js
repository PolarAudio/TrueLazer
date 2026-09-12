import { describe, it, expect } from 'vitest';
import { applyEffects, applyBlanking, applyColor, DEFAULT_FRAME_POINT_BUDGET } from './effects';
import { reduceFramePoints } from './pointReducer';

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
    
    // Buffer layout: original + mirrored + blanked bridge = 3 points
    expect(pts.length).toBe(3);
    expect(pts[0].x).toBeCloseTo(0.5);
    expect(pts[1].x).toBeCloseTo(-0.1);
    // The trailing bridge is a copy of the last original point, blanked
    expect(result.points[2 * 8 + 6]).toBe(1);
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
    expect(pts2[1].y).toBeCloseTo(-1);
  });

  it('should keep the buffer end blanked on closed frames so no connector line is drawn', () => {
    // A closed generator-style shape (e.g. circle) mirrored across X. The mirrored
    // copy must sit between the original polyline and a trailing blanked bridge, so
    // the renderer's frame-level closing edge (last -> first) can never draw a lit
    // connector line between the tail of the mirrored copy and the head of the original.
    const frame = mockFrame([
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.4 },
      { x: 0.7, y: 0.5 },
    ]);
    frame.isClosed = true;
    const effects = [{ id: 'mirror', params: { mode: 'x+', axisOffset: 0.2, additive: true } }];

    const result = applyEffects(frame, effects);
    const pts = getPoints(result);

    // Layout: original[3] + mirrored[3] + bridge[1] = 7
    expect(pts.length).toBe(7);

    // The head of the mirrored copy (its first point) must be blanked...
    expect(result.points[3 * 8 + 6]).toBe(1);
    // ...and the trailing bridge must be blanked so the closing edge is suppressed.
    expect(result.points[6 * 8 + 6]).toBe(1);

    // Mirrored points occupy the middle of the buffer (reverse order: p2, p1, p0)
    expect(pts[3].x).toBeCloseTo(-0.3); // mirror of x=0.7 -> 2*0.2 - 0.7
    expect(pts[4].x).toBeCloseTo(-0.2); // mirror of x=0.6 -> 2*0.2 - 0.6
    expect(pts[5].x).toBeCloseTo(-0.1); // mirror of x=0.5 -> 2*0.2 - 0.5
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

  it('should keep an all-off plateau (empty step) in channel mode when emptyStep is on', () => {
    const frame = mockFrame([{ x: 1, y: 0 }, { x: 0, y: 0 }]);
    const effects = [{
      id: 'chase',
      instanceId: 'c-empty',
      params: { mode: 'channel', emptyStep: true, decay: 0.8, speed: 1, overlap: 1, direction: 'left_to_right', useCustomOrder: false, customOrder: [] }
    }];
    const context = { assignedDacs: ['a', 'b', 'c', 'd'], progress: 0.5, time: 0, clipDuration: 1, effectStates: new Map() };
    const result = applyEffects(frame, effects, context);
    expect(result.points._channelDistributions).toBeDefined();
    let anyBlanked = false;
    for (let i = 0; i < result.points.length / 8; i++) {
      if (result.points[i * 8 + 6] > 0.5) anyBlanked = true;
    }
    expect(anyBlanked).toBe(true);
  });

  it('should crossfade continuously (no channel ever blanked) when emptyStep is off', () => {
    const frame = mockFrame([{ x: 1, y: 0 }, { x: 0, y: 0 }]);
    const effects = [{
      id: 'chase',
      instanceId: 'c-cont',
      params: { mode: 'channel', emptyStep: false, decay: 0.8, speed: 1, overlap: 1, direction: 'left_to_right', useCustomOrder: false, customOrder: [] }
    }];
    const context = { assignedDacs: ['a', 'b', 'c', 'd'], progress: 0.5, time: 0, clipDuration: 1, effectStates: new Map() };
    const result = applyEffects(frame, effects, context);
    expect(result.points._channelDistributions).toBeDefined();
    for (let i = 0; i < result.points.length / 8; i++) {
      expect(result.points[i * 8 + 6]).toBe(0);
      expect(result.points[i * 8 + 3]).toBeGreaterThan(0);
    }
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

describe('applyBlanking', () => {
  const createPointBuffer = (numPoints) => {
    const buf = new Float32Array(numPoints * 8);
    for (let i = 0; i < numPoints; i++) {
      buf[i * 8 + 0] = i; // x
      buf[i * 8 + 1] = 0; // y
      buf[i * 8 + 6] = 0; // blanking = 0
    }
    return buf;
  };

  it('does nothing when blankingInterval is 0 or negative', () => {
    const buf = createPointBuffer(100);
    applyBlanking(buf, 100, { blankingInterval: 0, spacing: 5 });
    for (let i = 0; i < 100; i++) {
      expect(buf[i * 8 + 6]).toBe(0);
    }
  });

  it('equally distributes blanking segments across points so the last segment has the same length', () => {
    const numPoints = 100;
    const buf = createPointBuffer(numPoints);
    // 4 blanking segments spaced equally along the shape
    applyBlanking(buf, numPoints, { blankingInterval: 4, spacing: 0 });

    // Each segment has length 25. With spacing=0, blankWidth=1 point at end of each segment.
    const blankedIndices = [];
    for (let i = 0; i < numPoints; i++) {
      if (buf[i * 8 + 6] === 1) {
        blankedIndices.push(i);
      }
    }

    // Exactly 4 blanking segments
    expect(blankedIndices).toEqual([24, 49, 74, 99]);

    // Segment lengths between blanks:
    // Segment 0: 0..24 (25 points, 1 blanked)
    // Segment 1: 25..49 (25 points, 1 blanked)
    // Segment 2: 50..74 (25 points, 1 blanked)
    // Segment 3: 75..99 (25 points, 1 blanked) -> Last segment length is identical to previous ones!
  });

  it('spacing changes the width between blanked segments equally across all segments', () => {
    const numPoints = 100;
    const buf = createPointBuffer(numPoints);
    // 4 blanking segments, spacing=4 -> blank width of 5 points per segment
    applyBlanking(buf, numPoints, { blankingInterval: 4, spacing: 4 });

    const blankedIndices = [];
    for (let i = 0; i < numPoints; i++) {
      if (buf[i * 8 + 6] === 1) {
        blankedIndices.push(i);
      }
    }

    // Each of the 4 segments has 5 blanked points at the end
    // Segment 0: 20..24
    // Segment 1: 45..49
    // Segment 2: 70..74
    // Segment 3: 95..99
    expect(blankedIndices.length).toBe(20);
    expect(blankedIndices.slice(0, 5)).toEqual([20, 21, 22, 23, 24]);
    expect(blankedIndices.slice(5, 10)).toEqual([45, 46, 47, 48, 49]);
    expect(blankedIndices.slice(10, 15)).toEqual([70, 71, 72, 73, 74]);
    expect(blankedIndices.slice(15, 20)).toEqual([95, 96, 97, 98, 99]);

    // Check that every segment has 20 lit points and 5 blanked points (last segment matches first)
    const litLengths = [
      blankedIndices[0] - 0,
      blankedIndices[5] - 25,
      blankedIndices[10] - 50,
      blankedIndices[15] - 75,
    ];
    expect(litLengths).toEqual([20, 20, 20, 20]);
  });

  it('handles non-divisible point counts evenly without cutting off the last segment', () => {
    const numPoints = 50;
    const buf = createPointBuffer(numPoints);
    // 3 segments on 50 points: segments will be round(50/3)=17, round(100/3)-17=17, 50-34=16
    applyBlanking(buf, numPoints, { blankingInterval: 3, spacing: 2 });

    const blankedBySegment = [[], [], []];
    // Segment ranges: 0..17, 17..33, 33..50
    for (let i = 0; i < numPoints; i++) {
      if (buf[i * 8 + 6] === 1) {
        if (i < 17) blankedBySegment[0].push(i);
        else if (i < 33) blankedBySegment[1].push(i);
        else blankedBySegment[2].push(i);
      }
    }

    // Every segment has 3 blanked points, including the last segment
    expect(blankedBySegment[0].length).toBe(3);
    expect(blankedBySegment[1].length).toBe(3);
    expect(blankedBySegment[2].length).toBe(3);
    // Last blanking segment ends exactly at the last point of the shape
    expect(blankedBySegment[2][2]).toBe(49);
  });

  it('works correctly within applyEffects pipeline', () => {
    const numPoints = 60;
    const points = new Float32Array(numPoints * 8);
    const frame = { points, isTypedArray: true };
    const effects = [{
      id: 'blanking',
      params: { blankingInterval: 3, spacing: 1, enabled: true }
    }];

    const result = applyEffects(frame, effects);
    let blankedCount = 0;
    for (let i = 0; i < numPoints; i++) {
      if (result.points[i * 8 + 6] === 1) blankedCount++;
    }
    // 3 segments * 2 blanked points = 6 blanked points
    expect(blankedCount).toBe(6);
  });
});

describe('applyColor', () => {
  const createBuffer = (numPoints) => new Float32Array(numPoints * 8);

  it('sets solid color correctly from hex and rgb values', () => {
    const numPoints = 10;
    const buf = createBuffer(numPoints);
    applyColor(buf, numPoints, { mode: 'solid', color: '#ff8800' });

    for (let i = 0; i < numPoints; i++) {
      expect(buf[i * 8 + 3]).toBe(255);
      expect(buf[i * 8 + 4]).toBe(136);
      expect(buf[i * 8 + 5]).toBe(0);
    }
  });

  it('interpolates rainbow colors across points without NaN or out-of-bounds values', () => {
    const numPoints = 50;
    const buf = createBuffer(numPoints);
    applyColor(buf, numPoints, { mode: 'rainbow', rainbowSpread: 1.0, rainbowOffset: 0 }, 0);

    for (let i = 0; i < numPoints; i++) {
      const r = buf[i * 8 + 3];
      const g = buf[i * 8 + 4];
      const b = buf[i * 8 + 5];
      expect(Number.isFinite(r)).toBe(true);
      expect(Number.isFinite(g)).toBe(true);
      expect(Number.isFinite(b)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it('correctly uses preset palettes like fire without errors', () => {
    const numPoints = 20;
    const buf = createBuffer(numPoints);
    applyColor(buf, numPoints, { mode: 'rainbow', rainbowPalette: 'fire' }, 0);

    for (let i = 0; i < numPoints; i++) {
      expect(Number.isFinite(buf[i * 8 + 3])).toBe(true);
      expect(Number.isFinite(buf[i * 8 + 4])).toBe(true);
      expect(Number.isFinite(buf[i * 8 + 5])).toBe(true);
    }
  });

  it('handles negative offsets and reverse speeds without NaN or crash', () => {
    const numPoints = 20;
    const buf = createBuffer(numPoints);
    applyColor(buf, numPoints, {
      mode: 'palette',
      paletteColors: ['#ff0000', '#00ff00', '#0000ff'],
      paletteSpread: 1.0,
      rainbowOffset: -90,
      cycleSpeed: -2
    }, 1000);

    for (let i = 0; i < numPoints; i++) {
      expect(Number.isFinite(buf[i * 8 + 3])).toBe(true);
      expect(Number.isFinite(buf[i * 8 + 4])).toBe(true);
      expect(Number.isFinite(buf[i * 8 + 5])).toBe(true);
      expect(buf[i * 8 + 3]).toBeGreaterThanOrEqual(0);
      expect(buf[i * 8 + 4]).toBeGreaterThanOrEqual(0);
      expect(buf[i * 8 + 5]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('applyRotate', () => {
  const mockFrame = (points) => ({
    points: new Float32Array(points.flatMap(p => [p.x, p.y, 0, 255, 255, 255, 0, 0])),
    isTypedArray: true
  });

  const rotAngle = (frame) => {
    const pts = frame.points;
    return Math.atan2(pts[1], pts[0]);
  };

  const rotateEff = (speed) => [
    { id: 'rotate', instanceId: 'r1', params: { angle: 0, speed, direction: 'CW' } }
  ];

  it('keeps rotation continuous when speed changes mid-playback', () => {
    const effectStates = new Map();
    const frame = mockFrame([{ x: 1, y: 0 }]);

    // 2 seconds at speed 10 -> phase = 20 rad
    applyEffects(frame, rotateEff(10), { time: 0, effectStates });
    applyEffects(frame, rotateEff(10), { time: 2000, effectStates });
    const before = rotAngle(applyEffects(frame, rotateEff(10), { time: 2000, effectStates }));

    // Speed param changes at the same instant: rotation must NOT jump.
    const after = rotAngle(applyEffects(frame, rotateEff(120), { time: 2000, effectStates }));
    expect(after - before).toBeCloseTo(0, 5);

    // And it keeps advancing at the new rate afterwards.
    const later = rotAngle(applyEffects(frame, rotateEff(120), { time: 2100, effectStates }));
    const delta = ((later - after) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    expect(delta).toBeCloseTo(12 % (2 * Math.PI), 1); // +0.1s * 120
  });

  it('falls back to absolute time when no effectStates is available', () => {
    const frame = mockFrame([{ x: 1, y: 0 }]);
    const a = rotAngle(applyEffects(frame, rotateEff(10), { time: 0 }));
    const b = rotAngle(applyEffects(frame, rotateEff(10), { time: 2000 }));
    const delta = ((b - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    expect(delta).toBeCloseTo(20 % (2 * Math.PI), 1);
  });
});

describe('applyWave', () => {
  const mockFrame = (points) => ({
    points: new Float32Array(points.flatMap(p => [p.x, p.y, 0, 255, 255, 255, 0, 0])),
    isTypedArray: true
  });

  const waveEff = (speed) => [
    { id: 'wave', instanceId: 'w1', params: { amplitude: 1, frequency: 1, speed, direction: 'y' } }
  ];

  it('keeps wave phase continuous when speed changes mid-playback', () => {
    const effectStates = new Map();
    const frame = mockFrame([{ x: 0, y: 0 }]);

    // 2 seconds at speed 10 -> phase = 20 rad
    applyEffects(frame, waveEff(10), { time: 0, effectStates });
    applyEffects(frame, waveEff(10), { time: 2000, effectStates });
    const before = applyEffects(frame, waveEff(10), { time: 2000, effectStates }).points[0];

    // Speed param changes at the same instant: displacement must NOT jump.
    const after = applyEffects(frame, waveEff(120), { time: 2000, effectStates }).points[0];
    expect(after).toBeCloseTo(before, 5);

    // And it keeps advancing at the new rate afterwards (phase 20 + 0.1s * 120 = 32 rad).
    const later = applyEffects(frame, waveEff(120), { time: 2100, effectStates }).points[0];
    expect(later).toBeCloseTo(Math.sin(32 % (2 * Math.PI)), 5);
  });

  it('falls back to absolute time when no effectStates is available', () => {
    const frame = mockFrame([{ x: 0, y: 0 }]);
    const t1 = applyEffects(frame, waveEff(10), { time: 0 }).points[0];
    const t2 = applyEffects(frame, waveEff(10), { time: 2000 }).points[0];
    expect(t1).toBeCloseTo(Math.sin(0), 5);
    expect(t2).toBeCloseTo(Math.sin(20 % (2 * Math.PI)), 5);
  });
});

describe('runaway point cap', () => {
  const mockFrame = (points) => ({
    points: new Float32Array(points.flatMap(p => [p.x, p.y, 0, 255, 255, 255, 0, 0])),
    isTypedArray: true
  });

  it('caps a mirror xN + frame delay stack so no output ever exceeds MAX_EFFECT_POINTS', () => {
    const frame = mockFrame(Array.from({ length: 4000 }, (_, i) => ({ x: (i % 2) - 0.5, y: 0 })));
    const effects = [
      { id: 'mirror', instanceId: 'm1', params: { mode: 'x+', axisOffset: 0.2, additive: true } },
      { id: 'mirror', instanceId: 'm2', params: { mode: 'y+', axisOffset: 0.1, additive: true } },
      { id: 'mirror', instanceId: 'm3', params: { mode: 'x+', axisOffset: -0.3, additive: true } },
      { id: 'mirror', instanceId: 'm4', params: { mode: 'y+', axisOffset: -0.2, additive: true } },
      { id: 'delay', instanceId: 'd1', params: { mode: 'frame', delayAmount: 1, steps: 20, decay: 0.8 } }
    ];

    // Un-capped: 4000 * 2^4 * 20 = 1.28M points -> formerly blew up past 100k
    // and tripped an out-of-range error downstream. Must stay bounded and valid.
    const effectStates = new Map();
    for (let i = 0; i < 3; i++) {
      const result = applyEffects(frame, effects, { effectStates, time: i * 100 });
      expect(result.points.length / 8).toBeLessThanOrEqual(16000);
      expect(result.points.length / 8).toBeGreaterThan(0);
    }
  });

  it('bounds frame-mode delay output to the per-frame point budget while keeping the echo count', () => {
    const frame = mockFrame(Array.from({ length: 2000 }, (_, i) => ({ x: (i % 2) - 0.5, y: 0 })));
    const effectStates = new Map();
    const effect = { id: 'delay', instanceId: 'fb1', params: { mode: 'frame', delayAmount: 1, steps: 20, decay: 0.8 } };

    const over = applyEffects(frame, [effect], { effectStates, time: 0 });
    expect(over.points.length / 8).toBeLessThanOrEqual(DEFAULT_FRAME_POINT_BUDGET);
    expect(over.points.length / 8).toBeGreaterThan(0);

    // Under-budget frames must pass through untouched (2000 pts, steps 1).
    const under = applyEffects(mockFrame([{ x: 0, y: 0 }, { x: 0, y: 1 }]), 
      [{ id: 'delay', instanceId: 'fb2', params: { mode: 'frame', delayAmount: 1, steps: 1, decay: 0.8 } }],
      { effectStates: new Map(), time: 0 });
    expect(under.points.length / 8).toBe(2);
  });

  it('honors an explicit context.framePointBudget override', () => {
    const frame = mockFrame(Array.from({ length: 400 }, (_, i) => ({ x: (i % 2) - 0.5, y: 0 })));
    const effect = { id: 'delay', instanceId: 'fb3', params: { mode: 'frame', delayAmount: 1, steps: 20, decay: 0.8 } };
    const result = applyEffects(frame, [effect], { effectStates: new Map(), time: 0, framePointBudget: 500 });
    expect(result.points.length / 8).toBeLessThanOrEqual(500);
  });

  it('reduces collinear (straight-line) frames without blowing the call stack', () => {
    // A drawn-out straight line: every interior point sits on the start-end
    // chord. The old recursive Douglas-Peucker recurred once per point here
    // and died with "Maximum call stack size exceeded" on mirror/delay stacks.
    const N = 30000;
    const pts = new Float32Array(N * 8);
    let off = 0;
    for (let i = 0; i < N; i++) {
      pts[off] = -1 + (2 * i) / (N - 1);
      pts[off + 1] = 0.5;
      pts[off + 3] = 255; pts[off + 4] = 255; pts[off + 5] = 255;
      off += 8;
    }
    let reduced;
    expect(() => { reduced = reduceFramePoints(pts, N, 1000); }).not.toThrow();
    expect(reduced.length / 8).toBeLessThanOrEqual(1000);
    expect(reduced.length).toBeGreaterThan(0);
  });
});


