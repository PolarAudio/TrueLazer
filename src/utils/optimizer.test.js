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