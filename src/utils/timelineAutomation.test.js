import { describe, it, expect } from 'vitest';
import {
    evaluateKeyframes, evaluateLane, transformFrame, applyLanesToPoints,
    resolveEasing, getLaneTarget, laneSvgPath,
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