import { describe, it, expect } from 'vitest';
import { decimatePoints } from '../../main/dac-budget.cjs';
import {
    resolveOutputFlip,
    flipPoints,
    padFrameToCount,
    padFrameForOutput,
    isShowbridgeOutput,
} from './useTimelinePlayback';

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

describe('padFrameToCount', () => {
    const frame = new Float32Array([
        0.5, 0.25, 0, 10, 20, 30, 0, 0,
        -0.5, 0.75, 0, 40, 50, 60, 1, 0,
    ]);

    it('pads to the requested length with blanked hold points at the last position', () => {
        const out = padFrameToCount(frame, 5);
        expect(out.length).toBe(5 * 8);
        // Original points are preserved.
        expect(out[0]).toBeCloseTo(0.5);
        expect(out[8]).toBeCloseTo(-0.5);
        // The fill holds the last position, is blanked and dark.
        expect(out[16]).toBeCloseTo(-0.5);
        expect(out[17]).toBeCloseTo(0.75);
        expect(out[22]).toBe(1);
        expect(out[19]).toBe(0);
        expect(out[20]).toBe(0);
        expect(out[21]).toBe(0);
    });

    it('returns the frame unchanged when it is already long enough', () => {
        expect(padFrameToCount(frame, 2)).toBe(frame);
        expect(padFrameToCount(frame, 1)).toBe(frame);
    });

    it('never modifies the source frame', () => {
        padFrameToCount(frame, 8);
        expect(frame.length).toBe(16);
    });

    it('handles an empty frame and a non-positive target', () => {
        expect(padFrameToCount(new Float32Array(0), 3).length).toBe(24);
        expect(padFrameToCount(frame, 0)).toBe(frame);
    });

    it('pads plain point arrays too', () => {
        const points = [{ x: 0.1, y: 0.2, r: 1, g: 2, b: 3, blanking: false }];
        const out = padFrameToCount(points, 3);
        expect(out.length).toBe(3);
        expect(out[1].x).toBeCloseTo(0.1);
        expect(out[1].blanking).toBe(true);
        expect(points.length).toBe(1);
    });
});

describe('isShowbridgeOutput', () => {
    it('matches Showbridge regardless of case', () => {
        expect(isShowbridgeOutput('Showbridge')).toBe(true);
        expect(isShowbridgeOutput('showbridge')).toBe(true);
        expect(isShowbridgeOutput('SHOWBRIDGE')).toBe(true);
    });

    it('does not match other DAC types or missing types', () => {
        expect(isShowbridgeOutput('EtherDream')).toBe(false);
        expect(isShowbridgeOutput('idn')).toBe(false);
        expect(isShowbridgeOutput(null)).toBe(false);
    });
});

describe('padFrameForOutput', () => {
    const makeFrame = (count) => {
        const frame = new Float32Array(count * 8);
        for (let i = 0; i < count; i++) {
            frame[i * 8] = (i / Math.max(1, count - 1)) * 2 - 1;
            frame[i * 8 + 3] = frame[i * 8 + 4] = frame[i * 8 + 5] = 255;
        }
        frame[(count - 1) * 8 + 7] = 1;
        return frame;
    };

    it('leaves Showbridge frames unpadded so the wire budget keeps their lit points', () => {
        const frame = makeFrame(500);

        // Timeline used to pad this to 1000, and Showbridge then decimated the
        // blanked hold tail down to 575 before it ever sampled the lit content.
        // The backend builds its own PTS_FULL wire frame, so no pre-padding is
        // needed here.
        expect(padFrameForOutput(frame, 'Showbridge', 1000)).toBe(frame);
        expect(decimatePoints(frame, 575)).toBe(frame);
    });

    it('still pads EtherDream / IDN frames to their fixed playback length', () => {
        const frame = makeFrame(2);
        const out = padFrameForOutput(frame, 'EtherDream', 5);

        expect(out.length).toBe(5 * 8);
        expect(out[4 * 8 + 6]).toBe(1);
    });

    it('does nothing for a non-positive target count', () => {
        const frame = makeFrame(2);
        expect(padFrameForOutput(frame, 'EtherDream', 0)).toBe(frame);
    });
});
