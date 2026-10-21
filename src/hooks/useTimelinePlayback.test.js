import { describe, it, expect } from 'vitest';
import { resolveOutputFlip, flipPoints } from './useTimelinePlayback';

describe('resolveOutputFlip', () => {
    it('mirrors an output when only the track asks for it', () => {
        expect(resolveOutputFlip(true, false, null)).toEqual({ flipX: true, flipY: false });
    });

    it('mirrors an output when only the Output Settings ask for it', () => {
        // The global flip is a hardware correction for a mirrored projector.
        // The Timeline used to ignore it and suppress it in the main process
        // as well, so the same DAC behaved differently in the two editors.
        expect(resolveOutputFlip(false, false, { flipX: true })).toEqual({ flipX: true, flipY: false });
        expect(resolveOutputFlip(false, false, { flipY: true })).toEqual({ flipX: false, flipY: true });
    });

    it('cancels the two mirrors against each other', () => {
        // They are the same operation on the same content, so applying both
        // is the same as applying neither.
        expect(resolveOutputFlip(true, false, { flipX: true })).toEqual({ flipX: false, flipY: false });
        expect(resolveOutputFlip(false, true, { flipY: true })).toEqual({ flipX: false, flipY: false });
    });

    it('keeps the axes independent', () => {
        expect(resolveOutputFlip(true, true, { flipX: true })).toEqual({ flipX: false, flipY: true });
    });

    it('treats a missing settings object as no global flip', () => {
        expect(resolveOutputFlip(false, false, undefined)).toEqual({ flipX: false, flipY: false });
        expect(resolveOutputFlip(false, false, {})).toEqual({ flipX: false, flipY: false });
    });
});

describe('flipPoints', () => {
    const frame = new Float32Array([
        0.5, 0.25, 0, 10, 20, 30, 0, 0,
        -0.5, 0.75, 0, 40, 50, 60, 1, 0,
    ]);

    it('negates the requested axes and copies the rest of the point', () => {
        const out = flipPoints(frame, true, false);
        expect(out[0]).toBeCloseTo(-0.5);
        expect(out[1]).toBeCloseTo(0.25);
        // The rest of the 8-float point is untouched: colour, blanking and
        // the last-point marker.
        expect(out[3]).toBe(10);
        expect(out[6]).toBe(0);
        expect(out[8]).toBeCloseTo(0.5);
        expect(out[14]).toBe(1);
    });

    it('leaves the source frame alone', () => {
        flipPoints(frame, true, true);
        expect(frame[0]).toBeCloseTo(0.5);
    });

    it('returns the same array when nothing is flipped', () => {
        expect(flipPoints(frame, false, false)).toBe(frame);
    });
});
