import { describe, it, expect } from 'vitest';
import { countPoints, computePointBudget, decimatePoints, clamp } from '../../main/dac-budget.cjs';

describe('dac-budget countPoints', () => {
    it('counts Float32Array points (8 floats each)', () => {
        expect(countPoints(new Float32Array(40))).toBe(5);
    });

    it('counts Uint8Array/Buffer points (8 bytes each)', () => {
        expect(countPoints(new Uint8Array(80))).toBe(10);
    });

    it('counts plain arrays one-per-element', () => {
        expect(countPoints([{}, {}, {}])).toBe(3);
    });

    it('returns 0 for null/empty', () => {
        expect(countPoints(null)).toBe(0);
        expect(countPoints(new Float32Array(0))).toBe(0);
        expect(countPoints('nope')).toBe(0);
    });
});

describe('dac-budget computePointBudget', () => {
    it('computes the pps/fps relation (30000 / 30 = 1000)', () => {
        expect(computePointBudget({ targetPps: 30000, targetFps: 30 })).toBe(1000);
    });

    it('caps at a hardware limit (PTS_FULL 575)', () => {
        expect(computePointBudget({ targetPps: 30000, targetFps: 30, cap: 575 })).toBe(575);
    });

    it('hardware cap binds below the pps/fps budget', () => {
        expect(computePointBudget({ targetPps: 17500, targetFps: 30, cap: 575 })).toBe(575);
    });

    it('applies sane defaults', () => {
        expect(computePointBudget({})).toBe(1000);
        expect(computePointBudget({ targetPps: 40000, targetFps: 60 })).toBe(667);
    });

    it('never returns 0', () => {
        expect(computePointBudget({ targetPps: 1000, targetFps: 360 })).toBeGreaterThanOrEqual(1);
    });
});

describe('dac-budget decimatePoints', () => {
    it('returns the same reference when within budget (no copy)', () => {
        const pts = new Float32Array(8);
        expect(decimatePoints(pts, 10)).toBe(pts);
    });

    it('decimates an oversized Float32Array to the budget', () => {
        // 80 points -> 10 points
        const pts = new Float32Array(80 * 8);
        for (let i = 0; i < 80; i++) pts[i * 8] = i;
        const out = decimatePoints(pts, 10);
        expect(out.length).toBe(10 * 8);
        // first and last coordinates preserved
        expect(out[0]).toBe(0);
        expect(out[9 * 8]).toBeCloseTo(79, 5);
    });

    it('preserves the end-of-frame marker on the last decimated point', () => {
        const pts = new Float32Array(40 * 8); // 40 points
        pts[(40 - 1) * 8 + 7] = 1;
        const out = decimatePoints(pts, 5);
        expect(out[(5 - 1) * 8 + 7]).toBe(1);
        for (let i = 0; i < (5 - 1) * 8 + 7; i++) expect(out[i]).not.toBe(1);
    });

    it('handles plain object arrays', () => {
        const pts = Array.from({ length: 40 }, (_, i) => ({ x: i, y: i, r: 1, g: 1, b: 1, blanking: false }));
        const out = decimatePoints(pts, 10);
        expect(out instanceof Float32Array).toBe(true);
        expect(out.length).toBe(80);
        expect(out[0]).toBe(0);
        expect(out[9 * 8]).toBeCloseTo(39, 5);
    });

    it('copies each sampled point faithfully (incl. blanking flag)', () => {
        const n = 40, target = 10;
        const pts = new Float32Array(n * 8);
        for (let i = 0; i < n; i++) {
            pts[i * 8 + 6] = i % 2; // alternate blank flag
            pts[i * 8] = i; // x coordinate = index
        }
        const out = decimatePoints(pts, target);
        for (let i = 0; i < target; i++) {
            const srcIdx = Math.round((i * (n - 1)) / (target - 1));
            expect(out[i * 8 + 6]).toBe(pts[srcIdx * 8 + 6]);
            expect(out[i * 8]).toBe(pts[srcIdx * 8]);
        }
    });

    it('never mutates the source buffer', () => {
        const pts = new Float32Array(80 * 8);
        for (let i = 0; i < 80; i++) pts[i * 8] = i;
        const snapshot = Array.from(pts);
        decimatePoints(pts, 10);
        expect(Array.from(pts)).toEqual(snapshot);
    });
});

describe('dac-budget clamp', () => {
    it('clamps into the [min,max] band', () => {
        expect(clamp(5, 1, 10)).toBe(5);
        expect(clamp(0, 1, 10)).toBe(1);
        expect(clamp(15, 1, 10)).toBe(10);
    });
});