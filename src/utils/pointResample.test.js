import { describe, it, expect } from 'vitest';
import {
    DEFAULT_MAX_STEP,
    DEFAULT_MAX_STEP_PX,
    EDITOR_PX_PER_DISPLAY_UNIT,
    resampleFrameToStep,
    resamplePolyline,
} from './pointResample';

/**
 * A laser DAC cannot draw a line between two points. The galvo flies from one
 * sample to the next, so a path whose segments are longer than the scanner
 * can resolve renders as a chain of discrete dots, and a very sparse path is
 * lit for only a handful of samples per frame - which reads as "the output is
 * off". These tests pin that behaviour down.
 */

const flat = (points) => {
    const out = new Float32Array(points.length * 8);
    points.forEach((p, i) => {
        const o = i * 8;
        out[o] = p.x; out[o + 1] = p.y; out[o + 2] = 0;
        out[o + 3] = p.r ?? 255; out[o + 4] = p.g ?? 255; out[o + 5] = p.b ?? 255;
        out[o + 6] = p.blanking ? 1 : 0; out[o + 7] = 0;
    });
    return out;
};

const read = (frame, i) => ({
    x: frame[i * 8], y: frame[i * 8 + 1],
    r: frame[i * 8 + 3], g: frame[i * 8 + 4], b: frame[i * 8 + 5],
    blanking: frame[i * 8 + 6] === 1,
});

const maxSegment = (frame) => {
    const n = frame.length / 8;
    let worst = 0;
    for (let i = 1; i < n; i++) {
        if (read(frame, i).blanking || read(frame, i - 1).blanking) continue;
        const d = Math.hypot(read(frame, i).x - read(frame, i - 1).x, read(frame, i).y - read(frame, i - 1).y);
        if (d > worst) worst = d;
    }
    return worst;
};

describe('step constants', () => {
    it('expresses the step in both spaces the app uses', () => {
        expect(DEFAULT_MAX_STEP).toBe(0.02);
        expect(EDITOR_PX_PER_DISPLAY_UNIT).toBe(500);
        expect(DEFAULT_MAX_STEP_PX).toBe(10);
    });
});

describe('resampleFrameToStep', () => {
    it('subdivides a long segment so the galvo never has to jump', () => {
        const frame = flat([{ x: 0, y: 0 }, { x: 0.4, y: 0 }]);
        const out = resampleFrameToStep(frame, { maxStep: DEFAULT_MAX_STEP });
        expect(out.length / 8).toBeGreaterThan(10);
        expect(maxSegment(out)).toBeLessThanOrEqual(DEFAULT_MAX_STEP + 1e-6);
    });

    it('leaves a path that is already dense alone', () => {
        const points = [];
        for (let i = 0; i <= 20; i++) points.push({ x: i * 0.01, y: 0 });
        const frame = flat(points);
        const out = resampleFrameToStep(frame, { maxStep: DEFAULT_MAX_STEP });
        expect(out.length).toBe(frame.length);
    });

    it('never interpolates across a blanked point', () => {
        // A lit run, a pen-up move, then another lit run far away. The gap
        // between the two runs must not be filled in.
        const frame = flat([
            { x: 0, y: 0 },
            { x: 0.1, y: 0 },
            { x: 0.5, y: 0, blanking: true },
            { x: 0.9, y: 0 },
        ]);
        const out = resampleFrameToStep(frame, { maxStep: DEFAULT_MAX_STEP });
        const n = out.length / 8;
        const blanks = [];
        for (let i = 0; i < n; i++) if (read(out, i).blanking) blanks.push(i);
        // Exactly one blanked point survives, and it is still in the middle.
        expect(blanks).toHaveLength(1);
        expect(blanks[0]).toBeGreaterThan(0);
        expect(blanks[0]).toBeLessThan(n - 1);
    });

    it('marks the last point of the frame', () => {
        const frame = flat([{ x: 0, y: 0 }, { x: 0.4, y: 0 }]);
        const out = resampleFrameToStep(frame, { maxStep: DEFAULT_MAX_STEP });
        expect(out[out.length - 1]).toBe(1);
    });

    it('accepts point objects as well as the typed layout', () => {
        const points = [{ x: 0, y: 0, r: 255, g: 0, b: 0 }, { x: 0.4, y: 0, r: 0, g: 255, b: 0 }];
        const out = resampleFrameToStep(points, { maxStep: DEFAULT_MAX_STEP });
        expect(out).toBeInstanceOf(Float32Array);
        expect(out.length / 8).toBeGreaterThan(2);
        // The colour is interpolated along the segment, not snapped.
        const mid = read(out, Math.floor(out.length / 16));
        expect(mid.r).toBeGreaterThan(0);
        expect(mid.g).toBeGreaterThan(0);
    });

    it('keeps the frame inside the point budget', () => {
        const frame = flat([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
        const out = resampleFrameToStep(frame, { maxStep: 0.001, maxPoints: 50 });
        expect(out.length / 8).toBeLessThanOrEqual(50);
    });

    it('does not interpolate when the source already fills the budget', () => {
        const frame = flat([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
        const out = resampleFrameToStep(frame, { maxStep: 0.001, maxPoints: 2 });
        expect(out.length / 8).toBe(2);
    });

    it('resamples each per-DAC slice on its own', () => {
        // Two DAC slices concatenated: slice A is lit, slice B is blanked.
        const frame = flat([
            { x: 0, y: 0 }, { x: 0.4, y: 0 },
            { x: 0.9, y: 0, blanking: true },
        ]);
        frame._channelDistributions = new Map([
            ['a', { start: 0, length: 16 }],
            ['b', { start: 16, length: 8 }],
        ]);
        const out = resampleFrameToStep(frame, { maxStep: DEFAULT_MAX_STEP });
        const dists = out._channelDistributions;
        expect(dists).toBeTruthy();
        expect(dists.get('a').start).toBe(0);
        expect(dists.get('b').start).toBe(dists.get('a').length);
        // Slice B was a single blanked point, so it stays a single point.
        expect(dists.get('b').length).toBe(8);
    });

    it('does not subdivide a frame that was already sampled at the same step', () => {
        // The export samples at the same step the DAC path does, and a frame is
        // stored as Float32, so every coordinate carries ~1e-7 of noise. The
        // DAC pass must not mistake that noise for an over-long segment and
        // subdivide the whole frame a second time.
        const points = [];
        for (let i = 0; i <= 20; i++) points.push({ x: -0.6 + i * 0.02, y: 0.6 });
        const frame = flat(points);
        const out = resampleFrameToStep(frame, { maxStep: DEFAULT_MAX_STEP });
        expect(out.length).toBe(frame.length);
    });

    it('handles an empty or single-point frame', () => {
        expect(resampleFrameToStep(null).length).toBe(0);
        expect(resampleFrameToStep(new Float32Array(0)).length).toBe(0);
        expect(resampleFrameToStep(flat([{ x: 1, y: 1 }])).length).toBe(8);
    });
});

describe('resamplePolyline', () => {
    const square = [
        { x: 0, y: 0, color: '#ff0000' },
        { x: 100, y: 0, color: '#ff0000' },
        { x: 100, y: 100, color: '#00ff00' },
        { x: 0, y: 100, color: '#00ff00' },
    ];

    it('subdivides a sparse outline', () => {
        const out = resamplePolyline(square, { maxStep: DEFAULT_MAX_STEP_PX });
        expect(out.length).toBeGreaterThan(square.length);
        let worst = 0;
        for (let i = 1; i < out.length; i++) {
            worst = Math.max(worst, Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
        }
        expect(worst).toBeLessThanOrEqual(DEFAULT_MAX_STEP_PX + 1e-6);
    });

    it('subdivides the closing segment of a closed outline', () => {
        const out = resamplePolyline(square, { maxStep: DEFAULT_MAX_STEP_PX, closed: true });
        // The seam from the last point back to the first is subdivided too, so
        // the shape does not have one long jump where it closes.
        const a = out[out.length - 1];
        const b = out[0];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(DEFAULT_MAX_STEP_PX + 1e-6);
    });

    it('does not repeat the first point of a closed outline', () => {
        const out = resamplePolyline(square, { maxStep: DEFAULT_MAX_STEP_PX, closed: true });
        // The beam program adds the closing vertex itself.
        expect(out[out.length - 1]).not.toBe(out[0]);
    });

    it('interpolates the colour along a segment', () => {
        const out = resamplePolyline(
            [{ x: 0, y: 0, color: '#ff0000' }, { x: 100, y: 0, color: '#0000ff' }],
            { maxStep: 10 }
        );
        expect(out.length).toBe(11);
        expect(out[5].color).not.toBe('#ff0000');
        expect(out[5].color).not.toBe('#0000ff');
    });

    it('keeps the outline inside the point budget', () => {
        const out = resamplePolyline(square, { maxStep: 0.5, maxPoints: 10 });
        expect(out.length).toBeLessThanOrEqual(10);
    });

    it('leaves a dense outline alone', () => {
        const dense = [];
        for (let i = 0; i <= 50; i++) dense.push({ x: i, y: 0, color: '#ffffff' });
        const out = resamplePolyline(dense, { maxStep: DEFAULT_MAX_STEP_PX });
        expect(out.length).toBe(dense.length);
    });

    it('handles degenerate input', () => {
        expect(resamplePolyline([])).toEqual([]);
        expect(resamplePolyline(null)).toEqual([]);
        expect(resamplePolyline([{ x: 1, y: 1 }])).toHaveLength(1);
    });
});
