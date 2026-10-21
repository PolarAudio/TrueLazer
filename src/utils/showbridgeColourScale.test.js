import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// The Showbridge writer lives in the main process, as CommonJS.
const require = createRequire(import.meta.url);
const { frameUses255Scale } = require('../../main/showbridge-communication.cjs');

const flat = (colours) => {
    const out = new Float32Array(colours.length * 8);
    colours.forEach((c, i) => {
        const o = i * 8;
        out[o] = 0; out[o + 1] = 0; out[o + 2] = 0;
        out[o + 3] = c[0]; out[o + 4] = c[1]; out[o + 5] = c[2];
        out[o + 6] = 0; out[o + 7] = 0;
    });
    return out;
};

describe('frameUses255Scale', () => {
    it('reads a frame of 0..255 colours as a 0..255 frame', () => {
        expect(frameUses255Scale(flat([[255, 0, 0], [0, 128, 255]]), true, 2)).toBe(true);
    });

    it('reads a frame of 0..1 colours as a 0..1 frame', () => {
        expect(frameUses255Scale(flat([[1, 0, 0], [0, 0.5, 1]]), true, 2)).toBe(false);
    });

    it('does not let a single channel decide the scale', () => {
        // A frame that uses 0..255 anywhere is a 0..255 frame. Deciding per
        // channel meant one channel sitting at exactly 1.0 was read as
        // "0..1 full white" and written as 255 - which is what the Invert
        // effect produced when it inverted a 254.
        expect(frameUses255Scale(flat([[1, 0, 0], [200, 0, 0]]), true, 2)).toBe(true);
    });

    it('reads an all-black frame as 0..1', () => {
        // Nothing above 1, so the frame is a 0..1 frame. Black is black
        // either way.
        expect(frameUses255Scale(flat([[0, 0, 0], [0, 0, 0]]), true, 2)).toBe(false);
    });

    it('handles point objects as well as the typed layout', () => {
        const points = [{ x: 0, y: 0, r: 1, g: 0, b: 0 }, { x: 0, y: 0, r: 255, g: 0, b: 0 }];
        expect(frameUses255Scale(points, false, 2)).toBe(true);
        expect(frameUses255Scale([{ x: 0, y: 0, r: 1, g: 0, b: 0 }], false, 1)).toBe(false);
    });
});
