import { describe, it, expect } from 'vitest';
import { optimizePoints } from './optimizer';

// Disable dwell/interpolation/padding so the output mirrors the source's
// lit/blanked structure 1:1, making closing-edge behavior deterministic.
const FLAT = {
    blankingStart: 0,
    blankingEnd: 0,
    anchorStart: 0,
    anchorEnd: 0,
    litDwellStart: 0,
    litDwellEnd: 0,
    cornerDwell: 0,
    minPadding: 0,
    interpDistance: 1000, // maxDist 2.0 -> no lit interpolation
    maxPoints: 4000,
};

function closedCircle(n, blankTail) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a), y: Math.sin(a), r: 255, g: 255, b: 255, blanking: false });
    }
    if (blankTail > 0) {
        for (let i = n - blankTail; i < n; i++) {
            pts[i] = { ...pts[i], r: 0, g: 0, b: 0, blanking: true };
        }
    }
    return pts;
}

describe('optimizePoints closing edge vs blanked tail', () => {
    it('does not synthesize a lit closing edge when the frame tail is blanked (isClosed forced)', () => {
        const src = closedCircle(20, 4);
        const out = optimizePoints(src, { ...FLAT, isClosed: true });
        const n = out.length / 8;

        expect(n).toBeGreaterThan(20);
        // Last point stays dark: no lit wrap-connector across the blanked tail.
        expect(out[(n - 1) * 8 + 6]).toBe(1);

        // Once the blanked tail begins, everything after it must stay blanked.
        let firstBlank = -1;
        for (let i = 0; i < n; i++) {
            if (out[i * 8 + 6] === 1) { firstBlank = i; break; }
        }
        expect(firstBlank).toBeGreaterThan(0);
        for (let i = firstBlank; i < n; i++) {
            expect(out[i * 8 + 6]).toBe(1);
        }
    });

    it('still synthesizes the closing edge for fully-lit closed frames', () => {
        const src = closedCircle(20, 0);
        const out = optimizePoints(src, { ...FLAT, isClosed: true });
        const n = out.length / 8;

        // Seam ends at the first point, lit (closing edge preserved).
        expect(out[(n - 1) * 8 + 6]).toBe(0);
    });

    it('respects a blanked tail even when no closed flag is given', () => {
        const src = closedCircle(20, 4);
        const out = optimizePoints(src, FLAT);
        const n = out.length / 8;

        expect(out[(n - 1) * 8 + 6]).toBe(1);
    });
});

// --- Regression: lit interpolation must actually fire ----------------------
//
// Smooth shapes rendered as discrete dots because the interpolation pass never
// ran: `interpDistance` defaults to 300, which maps to 0.6 display units — wider
// than any segment a generator emits — so every segment fell below the
// threshold. Coarse curves (circle ~0.063, sine ~0.074, text ~0.139) therefore
// reached the galvo as isolated samples, while finer straight-edged shapes
// (square 0.033, line 0.017) looked continuous.
//
// NOTE: the optimizer appends a blanked return sweep to the start of an open
// path, so these tests count LIT samples rather than total samples.
describe('optimizePoints lit interpolation', () => {
    const NO_DWELL = {
        blankingStart: 0,
        blankingEnd: 0,
        anchorStart: 0,
        anchorEnd: 0,
        litDwellStart: 0,
        litDwellEnd: 0,
        cornerDwell: 0,
        minPadding: 0,
        maxPoints: 4000,
    };

    // A straight lit run whose consecutive samples are `len` apart.
    function run(len, n, settings) {
        const pts = [];
        for (let i = 0; i < n; i++) {
            pts.push({ x: i * len, y: 0, r: 255, g: 255, b: 255, blanking: false });
        }
        return optimizePoints(pts, settings);
    }

    const litCount = (out) => {
        let c = 0;
        for (let i = 0; i < out.length / 8; i++) if (out[i * 8 + 6] <= 0.5) c++;
        return c;
    };

    it('honours an explicit maxDist instead of falling back to the preset', () => {
        // Without maxDist the preset maps to 0.6 units, so a 0.06-unit segment
        // is under threshold and is passed through untouched.
        expect(litCount(run(0.06, 20, { ...NO_DWELL }))).toBe(20);
        // With maxDist=0.02 each 0.06 segment splits into 3 lit samples.
        expect(litCount(run(0.06, 20, { ...NO_DWELL, maxDist: 0.02 }))).toBe(58);
    });

    it('subdivides segments in the 1x-2x band that used to be skipped', () => {
        // len/maxDist === 1.5, so the old `Math.floor` gave steps === 1 and the
        // loop body never ran: zero interpolation for these segments.
        const out = run(0.03, 20, { ...NO_DWELL, maxDist: 0.02 });
        // 1 midpoint + 1 endpoint per segment.
        expect(litCount(out)).toBe(39);
        // The midpoint really is halfway between the endpoints.
        expect(out[8]).toBeCloseTo(0.015, 5);
    });

    it('keeps consecutive lit samples within the requested step', () => {
        const out = run(0.06, 20, { ...NO_DWELL, maxDist: 0.02 });
        const n = out.length / 8;
        let maxGap = 0;
        for (let i = 1; i < n; i++) {
            if (out[i * 8 + 6] > 0.5 || out[(i - 1) * 8 + 6] > 0.5) continue;
            maxGap = Math.max(maxGap, Math.abs(out[i * 8] - out[(i - 1) * 8]));
        }
        expect(maxGap).toBeLessThanOrEqual(0.02 * 1.01);
    });

    it('interpolates across the closing edge of a closed path', () => {
        const out = optimizePoints(closedCircle(24, 0), { ...NO_DWELL, maxDist: 0.02, isClosed: true });
        expect(litCount(out)).toBeGreaterThan(24);
    });

    it('respects maxPoints even when maxDist demands far more samples', () => {
        // Unconstrained this would be ~3000 points (60 segments x 50 steps).
        const out = run(0.5, 60, { ...NO_DWELL, maxDist: 0.01, maxPoints: 120 });
        const n = out.length / 8;
        expect(n).toBeLessThan(300);
        // The budget is a soft target: the safety trim keeps the forced frame
        // ends and blank transitions, which can overshoot by a point or two.
        expect(n).toBeLessThanOrEqual(125);
    });

    it('pathDwell inserts settle samples either side of a beam toggle', () => {
        // Lit runs must span more than 0.05 units or the optimizer treats them
        // as dwell-only and skips their transition handling entirely.
        const pts = [
            { x: 0.0, y: 0, r: 255, g: 255, b: 255, blanking: false },
            { x: 0.2, y: 0, r: 255, g: 255, b: 255, blanking: false },
            { x: 0.4, y: 0, r: 0, g: 0, b: 0, blanking: true },
            { x: 0.5, y: 0, r: 0, g: 0, b: 0, blanking: true },
            { x: 0.7, y: 0, r: 255, g: 255, b: 255, blanking: false },
            { x: 0.9, y: 0, r: 255, g: 255, b: 255, blanking: false },
        ];
        // maxDist 2.0 disables interpolation so only pathDwell varies.
        const base = optimizePoints(pts, { ...NO_DWELL, maxDist: 2.0 });
        const dwell = optimizePoints(pts, { ...NO_DWELL, maxDist: 2.0, pathDwell: 2 });
        // Two toggles (lit->blank, blank->lit), two settle samples each.
        expect(dwell.length / 8).toBe(base.length / 8 + 4);
    });

    it('settle samples are dark, so the beam stays off while the galvo travels', () => {
        const pts = [
            { x: 0.00, y: 0, r: 255, g: 255, b: 255, blanking: false },
            { x: 0.01, y: 0, r: 0, g: 0, b: 0, blanking: true },
        ];
        const out = optimizePoints(pts, { ...NO_DWELL, maxDist: 0.02, pathDwell: 3 });
        for (let i = 0; i < out.length / 8; i++) {
            if (out[i * 8 + 6] > 0.5) {
                expect(out[i * 8 + 3]).toBe(0);
                expect(out[i * 8 + 4]).toBe(0);
                expect(out[i * 8 + 5]).toBe(0);
            }
        }
    });

    it('ignores undefined maxDist/pathDwell rather than producing NaN geometry', () => {
        const out = run(0.06, 20, { ...NO_DWELL, maxDist: undefined, pathDwell: undefined });
        expect(litCount(out)).toBe(20);
        for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
    });
});