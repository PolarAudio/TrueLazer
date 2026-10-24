import { describe, it, expect } from 'vitest';
import { clampZoomValue, playheadScrollCorrection, zoomFactorForWheel } from './timelineZoom';

/**
 * Zooming has to keep the PLAYHEAD where it is on screen. The playhead's
 * screen position is
 *
 *     headerWidth + playheadSec * zoom - scrollLeft
 *
 * so holding it still across a zoom change means
 *
 *     scrollLeft' = scrollLeft + playheadSec * (newZoom - oldZoom)
 */
describe('clampZoomValue', () => {
    it('keeps the zoom inside the allowed range', () => {
        expect(clampZoomValue(5, { min: 8, max: 600 })).toBe(8);
        expect(clampZoomValue(5000, { min: 8, max: 600 })).toBe(600);
        expect(clampZoomValue(50, { min: 8, max: 600 })).toBe(50);
    });

    it('falls back to the minimum for nonsense', () => {
        expect(clampZoomValue(NaN, { min: 8, max: 600 })).toBe(8);
        expect(clampZoomValue(undefined, { min: 8, max: 600 })).toBe(8);
    });
});

describe('playheadScrollCorrection', () => {
    it('leaves the scroll alone when the zoom does not change', () => {
        expect(playheadScrollCorrection({
            playheadSec: 12, oldZoom: 50, newZoom: 50, scrollLeft: 300,
        })).toBe(300);
    });

    it('scrolls by the playhead distance the zoom added', () => {
        // Zooming in doubles the pixels per second, so the playhead moves
        // 12s * 50px/s = 600px further right; the scroll follows it so the
        // playhead stays put on screen.
        expect(playheadScrollCorrection({
            playheadSec: 12, oldZoom: 50, newZoom: 100, scrollLeft: 300,
        })).toBe(300 + 12 * 50);
    });

    it('scrolls the other way when zooming out', () => {
        expect(playheadScrollCorrection({
            playheadSec: 12, oldZoom: 50, newZoom: 25, scrollLeft: 300,
        })).toBe(300 - 12 * 25);
    });

    it('keeps the playhead on screen for a playhead at zero', () => {
        expect(playheadScrollCorrection({
            playheadSec: 0, oldZoom: 50, newZoom: 100, scrollLeft: 300,
        })).toBe(300);
    });
});

describe('zoomFactorForWheel', () => {
    it('zooms in when the wheel scrolls up', () => {
        expect(zoomFactorForWheel(-100)).toBeGreaterThan(1);
        expect(zoomFactorForWheel(100)).toBeLessThan(1);
    });

    it('is continuous, so a trackpad gives a smooth zoom', () => {
        const small = zoomFactorForWheel(-10);
        const large = zoomFactorForWheel(-100);
        expect(large).toBeGreaterThan(small);
        expect(large / small).toBeCloseTo(Math.pow(1.0015, 90), 6);
    });
});
