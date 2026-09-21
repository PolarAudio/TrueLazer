import { describe, it, expect } from 'vitest';
import {
    evaluateKeyframes, evaluateLane, transformFrame, applyLanesToPoints,
    resolveEasing, getLaneTarget, laneSvgPath,
    getLaneParam, getLaneEffectDef, laneDefaultValue, evaluateLaneForEffect,
    buildChannelEffects, applyCueEffectOverrides,
    getLaneGenParam, getLaneGenDef, evaluateGenLane, buildGeneratorOverrides,
    activeAutoClip, automationClipAt, evaluateClipAt,
} from './timelineAutomation';

describe('resolveEasing', () => {
    it('parses bezier(x1,y1,x2,y2) strings and named presets', () => {
        expect(resolveEasing('bezier(0.25, 0.1, 0.25, 1.0)')).toEqual([0.25, 0.1, 0.25, 1]);
        expect(resolveEasing('easeInOut')).toEqual([0.42, 0, 0.58, 1]);
        expect(resolveEasing('linear')).toBeNull();
        expect(resolveEasing(null)).toBeNull();
        expect(resolveEasing('garbage')).toBeNull();
    });
});

describe('evaluateKeyframes', () => {
    const keys = [
        { time: 0, value: 0 },
        { time: 1, value: 1 },
        { time: 2, value: 0 },
    ];

    it('returns the default when empty', () => {
        expect(evaluateKeyframes([], 5, 7)).toBe(7);
    });

    it('clamps before the first and after the last keyframe', () => {
        expect(evaluateKeyframes(keys, -1)).toBe(0);
        expect(evaluateKeyframes(keys, 10)).toBe(0);
    });

    it('interpolates linearly by default', () => {
        expect(evaluateKeyframes(keys, 0.5)).toBeCloseTo(0.5);
        expect(evaluateKeyframes(keys, 1.5)).toBeCloseTo(0.5);
        expect(evaluateKeyframes(keys, 1)).toBe(1);
    });

    it('interpolates through a bezier easing curve', () => {
        const eased = [
            { time: 0, value: 0, easing: 'bezier(0.25, 0.1, 0.25, 1.0)' },
            { time: 1, value: 1 },
        ];
        // ease-in-out-ish: mid-time should sit above the linear 0.5 value
        const v = evaluateKeyframes(eased, 0.5);
        expect(v).toBeGreaterThan(0.5);
        expect(v).toBeLessThanOrEqual(1);
    });

    it('honours handleIn/handleOut control points', () => {
        const handled = [
            { time: 0, value: 0, handleOut: [0, 1] },
            { time: 1, value: 1, handleIn: [1, 0] },
        ];
        // P1=(0,1), P2=(0,1) in absolute space: x(t)=t^3 so the value at time
        // x=0.5 occurs at parameter t=0.7937 -> y=0.9916. A near-instant jump
        // (classic fast-ease-in start).
        expect(evaluateKeyframes(handled, 0.5)).toBeCloseTo(0.9916, 3);
        // And a handle pair pinned to (1/3,1/3) reproduces an exact straight line.
        const straight = [
            { time: 0, value: 0, handleOut: [1 / 3, 1 / 3] },
            { time: 1, value: 1, handleIn: [1 / 3, 1 / 3] },
        ];
        expect(evaluateKeyframes(straight, 0.5)).toBeCloseTo(0.5, 6);
    });

    it('is symmetric and monotonic for a symmetric ease', () => {
        const keys2 = [{ time: 0, value: 0, easing: 'easeInOut' }, { time: 2, value: 10 }];
        expect(evaluateKeyframes(keys2, 1.0)).toBeCloseTo(5, 2);
    });

    it('tension 0 keeps the segment perfectly linear', () => {
        const k = [{ time: 0, value: 0, tension: 0 }, { time: 2, value: 10 }];
        expect(evaluateKeyframes(k, 0.5)).toBeCloseTo(2.5, 6);
        expect(evaluateKeyframes(k, 1)).toBeCloseTo(5, 6);
        expect(evaluateKeyframes(k, 1.5)).toBeCloseTo(7.5, 6);
    });

    it('positive tension bows the curve up (slow start, fast end)', () => {
        const up = [{ time: 0, value: 0, tension: 1 }, { time: 1, value: 1 }];
        const mid = evaluateKeyframes(up, 0.5);
        expect(mid).toBeGreaterThan(0.5); // above the straight line
        expect(mid).toBeLessThan(1);
    });

    it('negative tension bows the curve down (fast start, slow end)', () => {
        const down = [{ time: 0, value: 0, tension: -1 }, { time: 1, value: 1 }];
        const mid = evaluateKeyframes(down, 0.5);
        expect(mid).toBeLessThan(0.5); // below the straight line
        expect(mid).toBeGreaterThan(0);
    });

    it('tension overrides a preset easing on the same keyframe', () => {
        const k = [{ time: 0, value: 0, easing: 'easeInOut', tension: 1 }, { time: 1, value: 1 }];
        const eased = evaluateKeyframes([{ time: 0, value: 0, easing: 'easeInOut' }, { time: 1, value: 1 }], 0.5);
        const tensioned = evaluateKeyframes(k, 0.5);
        // easeInOut midpoint sits near 0.5; tension 1 sits well above it.
        expect(tensioned).toBeGreaterThan(eased + 0.05);
    });

    it('hold keeps the outgoing value until the next keyframe, then steps', () => {
        const k = [{ time: 0, value: 1, easing: 'hold' }, { time: 2, value: 5 }];
        expect(evaluateKeyframes(k, 0.1)).toBe(1);
        expect(evaluateKeyframes(k, 1.9)).toBe(1);
        expect(evaluateKeyframes(k, 2)).toBe(5);
        expect(evaluateKeyframes(k, 5)).toBe(5);
    });
});

describe('evaluateLane', () => {
    it('uses the target default when a lane has no keyframes', () => {
        expect(evaluateLane({ targetProperty: 'GEOMETRY_SCALE', keyframes: [] }, 3)).toBe(1);
        expect(evaluateLane({ targetProperty: 'GEOMETRY_ROTATION', keyframes: [] }, 3)).toBe(0);
        expect(evaluateLane({}, 3)).toBe(1);
    });
});

function makeFrame(n = 4) {
    const f = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
        const o = i * 8;
        f[o] = i;
        f[o + 1] = i + 1;
        f[o + 2] = 0; // z
        f[o + 3] = 255;
        f[o + 4] = 128;
        f[o + 5] = 64;
        f[o + 6] = 0;
        f[o + 7] = i === n - 1 ? 1 : 0;
    }
    return f;
}

describe('transformFrame', () => {
    it('scales geometry without mutating the source', () => {
        const src = makeFrame();
        const out = transformFrame(src, { scale: 2 });
        expect(out).not.toBe(src);
        expect(out[0]).toBe(0);
        expect(out[1]).toBeCloseTo(2);
        expect(out[9]).toBeCloseTo(4);
        expect(src[9]).toBe(2); // untouched
    });

    it('rotates points around the origin by 90 degrees', () => {
        const src = makeFrame(2);
        const out = transformFrame(src, { rotationDeg: 90 });
        // Frame points (0,1) and (1,2); 90° CCW -> (-1,0) and (-2,1)
        expect(out[0]).toBeCloseTo(-1, 5);
        expect(out[1]).toBeCloseTo(0, 5);
        expect(out[8]).toBeCloseTo(-2, 5);
        expect(out[9]).toBeCloseTo(1, 5);
    });

    it('scales rgb channels and preserves blanking/lastPoint flags', () => {
        const src = makeFrame();
        const out = transformFrame(src, { brightness: 0.5, red: 2 });
        expect(out[3]).toBeCloseTo(255 * 2 * 0.5);
        expect(out[6]).toBe(0);
        expect(out[31]).toBe(1);
    });

    it('translates x/y', () => {
        const src = makeFrame();
        const out = transformFrame(src, { translateX: 10, translateY: -5 });
        expect(out[0]).toBe(10);
        expect(out[1]).toBeCloseTo(-4);
    });

    it('clamps color channels to 0..255 so boosts cannot overflow 8-bit DAC bytes', () => {
        const src = makeFrame(); // 8-bit colors: r=255, g=128, b=64
        const out = transformFrame(src, { brightness: 2, blue: 1.5 }); // both scale every channel
        expect(out[3]).toBe(255); // 255 * 2 saturates, not 510
        expect(out[4]).toBe(255); // 128 * 2 saturates
        expect(out[5]).toBe(192); // 64 * 2 * 1.5 saturates too (was 384 > 255)
        expect(out[3]).toBeLessThanOrEqual(255);
        expect(out[4]).toBeLessThanOrEqual(255);
        expect(out[5]).toBeLessThanOrEqual(255);
    });

    it('never produces negative color channels', () => {
        const src = makeFrame();
        const out = transformFrame(src, { brightness: -1 });
        expect(out[3]).toBe(0);
        expect(out[4]).toBe(0);
        expect(out[5]).toBe(0);
    });
});

describe('applyLanesToPoints', () => {
    it('accumulates all lane values into the frame at the playhead time', () => {
        const src = makeFrame();
        const lanes = [
            { targetProperty: 'GEOMETRY_SCALE', keyframes: [{ time: 0, value: 1 }, { time: 10, value: 2 }] },
            { targetProperty: 'GEOMETRY_SCALE', keyframes: [{ time: 0, value: 3 }] }, // compounds x3
            { targetProperty: 'GEOMETRY_TRANSLATION_X', keyframes: [{ time: 0, value: 0 }, { time: 10, value: 5 }] },
            { targetProperty: 'COLOR_MAX_BRIGHTNESS', keyframes: [{ time: 0, value: 1 }, { time: 10, value: 0.25 }] },
        ];
        // At t=10: scale=6, tx=5, brightness=0.25
        const out = applyLanesToPoints(src, lanes, 10);
        expect(out[0]).toBeCloseTo(0 * 6 + 5);
        expect(out[1]).toBeCloseTo(6);
        expect(out[3]).toBeCloseTo(255 * 0.25);
        // Source untouched
        expect(src[1]).toBe(1);
    });
});

describe('laneSvgPath', () => {
    it('returns null without keyframes and a path with one', () => {
        expect(laneSvgPath({ keyframes: [] }, 10)).toBeNull();
        const p = laneSvgPath({ targetProperty: 'GEOMETRY_SCALE', keyframes: [{ time: 0, value: 1 }, { time: 10, value: 2 }] }, 10);
        expect(p).toContain('C ');
        expect(p).toContain('M ');
    });
});

describe('effect-linked lanes', () => {
    it('getLaneParam resolves only continuous range controls', () => {
        expect(getLaneParam({ effectId: 'rotate', paramId: 'angle' }).type).toBe('range');
        expect(getLaneParam({ effectId: 'rotate', paramId: 'angle' }).min).toBe(0);
        expect(getLaneParam({ effectId: 'rotate', paramId: 'direction' })).toBeNull(); // select
        expect(getLaneParam({ effectId: 'rotate' })).toBeNull(); // no param
        expect(getLaneParam({})).toBeNull(); // unassigned
        expect(getLaneParam({ effectId: 'nope', paramId: 'x' })).toBeNull(); // unknown effect
    });

    it('getLaneEffectDef returns the main-app effect declaration', () => {
        expect(getLaneEffectDef({ effectId: 'translate' }).name).toBe('Translate');
        expect(getLaneEffectDef({})).toBeNull();
    });

    it('laneDefaultValue prefers the effect defaultParams over mid-range', () => {
        expect(laneDefaultValue({ effectId: 'scale', paramId: 'scaleX' })).toBe(1);
        expect(laneDefaultValue({ effectId: 'rotate', paramId: 'angle' })).toBe(0);
        expect(laneDefaultValue({ effectId: 'warp', paramId: 'amount' })).toBe(0.5);
        // Legacy lanes keep the built-in target default.
        expect(laneDefaultValue({ targetProperty: 'GEOMETRY_SCALE' })).toBe(1);
    });

    it('evaluateLaneForEffect falls back to the param default on empty curves', () => {
        expect(evaluateLaneForEffect({ effectId: 'scale', paramId: 'scaleX', keyframes: [] }, 3)).toBe(1);
        expect(evaluateLaneForEffect({ effectId: 'rotate', paramId: 'angle', keyframes: [{ time: 0, value: 90 }, { time: 10, value: 0 }] }, 10)).toBe(0);
    });

    it('evaluateLane routes effect-linked lanes to their param default', () => {
        expect(evaluateLane({ effectId: 'translate', paramId: 'translateX', keyframes: [] }, 4)).toBe(0);
        expect(evaluateLane({}, 3)).toBe(1); // legacy fallback untouched
    });

    it('buildChannelEffects ignores unassigned / non-range lanes and merges by effect', () => {
        const lanes = [
            { id: 'l1' }, // empty
            { id: 'l2', effectId: 'rotate', paramId: 'direction' }, // select param -> ignored
            { id: 'l3', effectId: 'scale', paramId: 'scaleX', keyframes: [{ time: 0, value: 1 }, { time: 10, value: 2 }] },
            { id: 'l4', effectId: 'scale', paramId: 'scaleY', keyframes: [{ time: 0, value: 1 }] },
            { id: 'l5', effectId: 'rotate', paramId: 'angle', keyframes: [] },
        ];
        const effects = buildChannelEffects(lanes, 10, 'ch1');
        expect(effects).toHaveLength(2);
        const scale = effects.find((e) => e.id === 'scale');
        expect(scale.instanceId).toBe('auto.ch1.scale');
        expect(scale.params.scaleX).toBeCloseTo(2);
        expect(scale.params.scaleY).toBeCloseTo(1);
        expect(scale.params.centerX).toBeUndefined();
        const rotate = effects.find((e) => e.id === 'rotate');
        expect(rotate.params.angle).toBeCloseTo(0); // empty curve -> defaultParams angle
        expect(rotate.params.direction).toBe('CW'); // non-automated params keep defaults
    });

    it('buildChannelEffects instance ids never collide across channels', () => {
        const a = buildChannelEffects([{ id: 'x', effectId: 'wave', paramId: 'amplitude' }], 0, 'chA');
        const b = buildChannelEffects([{ id: 'x', effectId: 'wave', paramId: 'amplitude' }], 0, 'chB');
        expect(a[0].instanceId).not.toBe(b[0].instanceId);
    });

    it('buildChannelEffects returns [] when nothing is automatable', () => {
        expect(buildChannelEffects([], 0, 'ch1')).toEqual([]);
        expect(buildChannelEffects([{ id: 'l', effectId: 'mirror', paramId: 'mode' }], 0, 'ch1')).toEqual([]);
    });

    it('buildChannelEffects reads the ACTIVE CLIP (not the lane) for effect and param', () => {
        const lanes = [{
            id: 'l1',
            keyframes: [],
            clips: [
                { id: 'a', startTime: 0, duration: 4, effectId: 'rotato', genId: 'circle', keyframes: [], values: {} },
                { id: 'b', startTime: 4, duration: 4, effectId: 'scale', paramId: 'scaleX', keyframes: [], values: { scaleY: 3 } },
            ],
        }];
        // At t=2 clip 'a' drives: genId only -> generator clip, no channel effect.
        expect(buildChannelEffects(lanes, 2, 'ch1')).toEqual([]);
        // At t=5 clip 'b' drives: scaleX via the empty curve -> default 1, and its
        // per-clip static value scaleY:3 must be merged in.
        const effects = buildChannelEffects(lanes, 5, 'ch1');
        expect(effects).toHaveLength(1);
        expect(effects[0].id).toBe('scale');
        expect(effects[0].params.scaleX).toBeCloseTo(1);
        expect(effects[0].params.scaleY).toBeCloseTo(3);
    });

    it('buildChannelEffects keeps legacy lane-level targets working (synthesized clip)', () => {
        const effects = buildChannelEffects(
            [{ id: 'l1', effectId: 'wave', paramId: 'amplitude', keyframes: [{ time: 0, value: 0.5 }] }],
            0,
            'ch1'
        );
        expect(effects).toHaveLength(1);
        expect(effects[0].id).toBe('wave');
        expect(effects[0].params.amplitude).toBeCloseTo(0.5);
    });
});

describe('per-clip effect overrides', () => {
    it('applies non-range overrides and leaves range params to the curves', () => {
        const lanes = [
            { id: 'l1', effectId: 'delay', paramId: 'delayAmount', keyframes: [{ time: 0, value: 8 }, { time: 10, value: 8 }] },
            { id: 'l2', effectId: 'delay', paramId: 'steps', keyframes: [] },
        ];
        const effects = buildChannelEffects(lanes, 5, 'ch1');
        expect(effects).toHaveLength(1);
        const delay = effects[0];
        expect(delay.params.delayAmount).toBeCloseTo(8);

        const out = applyCueEffectOverrides(effects, {
            delay: {
                delayDirection: 'right_to_left',
                useCustomOrder: true,
                // Range params + unknown ids must be ignored, never injected.
                delayAmount: 999,
                bogus: 'nope',
            },
        });
        expect(out).toHaveLength(1);
        expect(out[0].params.delayDirection).toBe('right_to_left');
        expect(out[0].params.useCustomOrder).toBe(true);
        expect(out[0].params.delayAmount).toBeCloseTo(8);
        expect(out[0].params.bogus).toBeUndefined();
    });

    it('overrides for unknown effects change nothing', () => {
        const effects = buildChannelEffects(
            [{ id: 'l1', effectId: 'rotate', paramId: 'angle', keyframes: [] }],
            0,
            'ch1'
        );
        const out = applyCueEffectOverrides(effects, { ghost: { mode: 'x' } });
        expect(out).toBe(effects);
        expect(out[0].params.angle).toBeCloseTo(0);
        expect(out[0].params.mode).toBeUndefined();
    });

    it('returns the array as-is when there is nothing to override', () => {
        const effects = [
            { id: 'rotate', instanceId: 'auto.ch1.rotate', params: { angle: 90, direction: 'CW' } },
        ];
        expect(applyCueEffectOverrides(effects, {})).toBe(effects);
        expect(applyCueEffectOverrides(effects, null)).toBe(effects);
        expect(applyCueEffectOverrides([], { rotate: { direction: 'CCW' } })).toEqual([]);
        expect(applyCueEffectOverrides(effects, { rotate: { direction: 'CW' } })).toBe(effects);
    });
});

describe('generator parameter automation', () => {
    it('getLaneGenParam resolves range controls and rejects non-range types', () => {
        expect(getLaneGenParam({ genId: 'circle', genParamId: 'radius' }).min).toBeCloseTo(0.01);
        expect(getLaneGenParam({ genId: 'circle', genParamId: 'renderingStyle' })).toBeNull();
        expect(getLaneGenParam({ genId: 'nope', genParamId: 'radius' })).toBeNull();
        expect(getLaneGenParam({ genId: 'circle' })).toBeNull();
        expect(getLaneGenDef({ genId: 'square' }).id).toBe('square');
        expect(getLaneGenDef({ genId: 'missing' })).toBeNull();
    });

    it('evaluateGenLane holds the base value on an empty curve', () => {
        expect(evaluateGenLane({ keyframes: [] }, 5, 0.42)).toBe(0.42);
        expect(evaluateGenLane({ keyframes: [{ time: 0, value: 0.1 }, { time: 1, value: 0.9 }] }, 0.5, 0.42)).toBeCloseTo(0.5);
    });

    it('buildGeneratorOverrides applies only matching range-param lanes', () => {
        const lanes = [
            { id: 'a', genId: 'circle', genParamId: 'radius', keyframes: [{ time: 0, value: 0.3 }] },
            { id: 'b', genId: 'circle', genParamId: 'x', keyframes: [] },           // empty -> base param
            { id: 'c', genId: 'square', genParamId: 'width', keyframes: [{ time: 0, value: 1.5 }] }, // other gen
            { id: 'd', genId: 'circle', genParamId: 'renderingStyle' },             // select, not animatable
            { id: 'e', effectId: 'rotate', paramId: 'angle' },                      // effect lane, ignored
        ];
        const over = buildGeneratorOverrides(lanes, 0, 'circle', { radius: 0.1, x: 0.8 });
        expect(over).not.toBeNull();
        expect(over.radius).toBeCloseTo(0.3);
        expect(over.x).toBeCloseTo(0.8); // empty curve keeps the clip's own slider value
        expect(Object.keys(over).sort()).toEqual(['radius', 'x']);
    });

    it('buildGeneratorOverrides returns null when no lane drives the generator', () => {
        expect(buildGeneratorOverrides([
            { id: 'a', genId: 'square', genParamId: 'width', keyframes: [] },
        ], 0, 'circle', { radius: 0.5 })).toBeNull();
        expect(buildGeneratorOverrides([], 0, 'circle')).toBeNull();
    });
});

describe('automation clips (FL-style multi-clip lanes)', () => {
    const clipLane = (clips) => ({
        id: 'l1',
        effectId: 'translate',
        paramId: 'x',
        keyframes: [],
        clips,
    });

    const legacyLane = {
        id: 'l1',
        targetProperty: 'GEOMETRY_SCALE',
        keyframes: [{ time: 0, value: 1 }, { time: 10, value: 2 }],
    };

    it('activeAutoClip returns the covering clip (end-exclusive) or null', () => {
        const lane = clipLane([
            { id: 'a', startTime: 0, duration: 4, keyframes: [] },
            { id: 'b', startTime: 4, duration: 3, keyframes: [] },
        ]);
        expect(activeAutoClip(lane, 0).id).toBe('a');
        expect(activeAutoClip(lane, 3.999).id).toBe('a');
        expect(activeAutoClip(lane, 4).id).toBe('b');
        expect(activeAutoClip(lane, 6.9).id).toBe('b');
        expect(activeAutoClip(lane, 7)).toBeNull();
        expect(activeAutoClip({}, 0)).toBeNull();
        expect(activeAutoClip({ clips: [] }, 0)).toBeNull();
    });

    it('evaluateLaneForEffect reads clip-relative keyframes from the active clip', () => {
        const lane = clipLane([
            // clip 'a' spans t=2..6; inside it the curve runs 0..2 over 4s.
            { id: 'a', startTime: 2, duration: 4, keyframes: [{ time: 0, value: 0 }, { time: 2, value: 2 }] },
        ]);
        expect(evaluateLaneForEffect(lane, 2)).toBe(0);
        expect(evaluateLaneForEffect(lane, 3)).toBeCloseTo(1);
        expect(evaluateLaneForEffect(lane, 4)).toBe(2);
        expect(evaluateLaneForEffect(lane, 0)).toBe(laneDefaultValue(lane));
        expect(evaluateLaneForEffect(lane, 6.5)).toBe(laneDefaultValue(lane));
    });

    it('evaluateGenLane uses the active clip curve and the base value outside clips', () => {
        const lane = clipLane([
            { id: 'a', startTime: 1, duration: 2, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] },
        ]);
        expect(evaluateGenLane(lane, 1.5, 5)).toBeCloseTo(0.5);
        expect(evaluateGenLane(lane, 0, 5)).toBe(5);
        expect(evaluateGenLane(lane, 3.5, 5)).toBe(5);
    });

    it('evaluateLaneForEffect falls back to lane.keyframes when the lane has no clips', () => {
        expect(evaluateLaneForEffect(legacyLane, 0)).toBe(1);
        expect(evaluateLaneForEffect(legacyLane, 5)).toBeCloseTo(1.5);
        expect(evaluateLaneForEffect(legacyLane, 10)).toBe(2);
    });

    it('evaluateLane honors clip-relative keyframes and the default outside them', () => {
        const lane = clipLane([
            { id: 'a', startTime: 2, duration: 2, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] },
        ]);
        expect(evaluateLane(lane, 2.5)).toBeCloseTo(0.5);
        expect(evaluateLane(lane, 1)).toBe(laneDefaultValue(lane));
    });

    it('automationClipAt synthesizes a whole-lane clip for legacy lanes', () => {
        const clip = automationClipAt(legacyLane, 5);
        expect(clip).not.toBeNull();
        expect(clip.startTime).toBe(0);
        expect(clip.targetProperty).toBe('GEOMETRY_SCALE');
        expect(clip.keyframes).toBe(legacyLane.keyframes);
        expect(automationClipAt(legacyLane, 100)).not.toBeNull();
    });

    it('automationClipAt returns null inside clip gaps and {} on empty lanes', () => {
        const lane = clipLane([
            { id: 'a', startTime: 0, duration: 2, keyframes: [] },
            { id: 'b', startTime: 4, duration: 2, keyframes: [] },
        ]);
        expect(automationClipAt(lane, 1).id).toBe('a');
        expect(automationClipAt(lane, 3)).toBeNull();
        expect(automationClipAt(lane, 5).id).toBe('b');
        expect(automationClipAt({}, 3)).toBeNull();
    });

    it('evaluateClipAt evaluates clip-relative keyframes and falls back to the default', () => {
        const clip = { id: 'a', startTime: 2, duration: 4, keyframes: [{ time: 0, value: 10 }, { time: 2, value: 20 }] };
        expect(evaluateClipAt(clip, 2, 7)).toBe(10);
        expect(evaluateClipAt(clip, 3, 7)).toBeCloseTo(15);
        expect(evaluateClipAt(clip, 4, 7)).toBe(20);
        expect(evaluateClipAt(clip, 6.5, 7)).toBe(7);
        expect(evaluateClipAt(clip, 0, 7)).toBe(7);
        expect(evaluateClipAt({ keyframes: [] }, 0, 3)).toBe(3);
    });

    it('buildGeneratorOverrides merges the active clip values and reads gen ids from the clip', () => {
        const lanes = [{
            id: 'l1',
            keyframes: [],
            clips: [
                { id: 'a', startTime: 0, duration: 3, genId: 'circle', genParamId: 'x', keyframes: [], values: { radius: 0.55 } },
                { id: 'b', startTime: 3, duration: 3, genId: 'circle', genParamId: 'radius', keyframes: [{ time: 0, value: 0.9 }], values: {} },
            ],
        }];
        // Inside clip 'b': radius comes from the curve (0.9), x falls back to the generator's own 0.8.
        const overB = buildGeneratorOverrides(lanes, 3.5, 'circle', { radius: 0.1, x: 0.8 });
        expect(overB).not.toBeNull();
        expect(overB.radius).toBeCloseTo(0.9);
        expect(overB.x).toBeCloseTo(0.8);

        // Inside clip 'a': empty curve, but the clip's values.radius:0.55 must win
        // over the generator base, and x stays on the base curve default.
        const overA = buildGeneratorOverrides(lanes, 1, 'circle', { radius: 0.1, x: 0.4 });
        expect(overA).not.toBeNull();
        expect(overA.radius).toBeCloseTo(0.55);
        expect(overA.x).toBeCloseTo(0.4);
    });
});