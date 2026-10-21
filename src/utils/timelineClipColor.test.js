import { describe, it, expect } from 'vitest';
import { parseHex, toRgba, clipBlockStyle, cueColorOrDefault } from './timelineClipColor';

// The overlap-stripe fix depends on this returning a style ONLY when the user
// picked a colour. If it returned one for an uncoloured cue it would inline a
// background and defeat the type-based defaults in index.css, changing how every
// clip in every existing project renders.
describe('clipBlockStyle', () => {
    it('returns null when the cue has no colour of its own', () => {
        expect(clipBlockStyle({ id: 'c1' })).toBeNull();
        expect(clipBlockStyle({ id: 'c1', color: null })).toBeNull();
        expect(clipBlockStyle({ id: 'c1', color: '' })).toBeNull();
    });

    it('is safe with no cue at all', () => {
        expect(clipBlockStyle(null)).toBeNull();
        expect(clipBlockStyle(undefined)).toBeNull();
    });

    it('builds a translucent gradient so the light label stays legible', () => {
        const s = clipBlockStyle({ color: '#ff8800' });
        expect(s).not.toBeNull();
        expect(s.background).toContain('linear-gradient');
        expect(s.background).toContain('rgba(255, 136, 0');
        expect(s.borderColor).toBe('rgba(255, 136, 0, 0.55)');
    });

    it('produces a style for every common hex form', () => {
        for (const c of ['#fff', '#ffffff', '#1A2B3C', '#123456']) {
            expect(clipBlockStyle({ color: c }), c).not.toBeNull();
        }
    });

    it('refuses an unparseable colour rather than blanking the clip out', () => {
        // A bad value must fall back to the CSS default, never paint nothing.
        expect(clipBlockStyle({ color: 'not-a-color' })).toBeNull();
        expect(clipBlockStyle({ color: '#12345' })).toBeNull();
        expect(clipBlockStyle({ color: 12345 })).toBeNull();
        expect(clipBlockStyle({ color: 'rgb(oops)' })).toBeNull();
    });
});

describe('parseHex', () => {
    it('parses 6-digit hex', () => {
        expect(parseHex('#0089ff')).toEqual([0, 137, 255]);
        expect(parseHex('0089FF')).toEqual([0, 137, 255]);
    });

    it('expands 3-digit hex', () => {
        expect(parseHex('#f0a')).toEqual([255, 0, 170]);
    });

    it('accepts the rgb()/rgba() forms a browser may round-trip', () => {
        expect(parseHex('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
        expect(parseHex('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3]);
    });

    it('returns null for anything else', () => {
        for (const v of [null, undefined, '', '#', 'zzz', '#1234567', 42, {}]) {
            expect(parseHex(v), String(v)).toBeNull();
        }
    });
});

describe('toRgba', () => {
    it('applies the alpha', () => {
        expect(toRgba('#0089ff', 0.5)).toBe('rgba(0, 137, 255, 0.5)');
    });

    it('clamps alpha into 0..1', () => {
        expect(toRgba('#000000', -1)).toBe('rgba(0, 0, 0, 0)');
        expect(toRgba('#000000', 5)).toBe('rgba(0, 0, 0, 1)');
    });

    it('returns null for an unparseable colour', () => {
        expect(toRgba('nope', 0.5)).toBeNull();
    });
});

describe('cueColorOrDefault', () => {
    it('prefers the cue colour', () => {
        expect(cueColorOrDefault({ color: '#123456' })).toBe('#123456');
    });

    it('falls back when unset or missing', () => {
        expect(cueColorOrDefault({})).toBe('#0089ff');
        expect(cueColorOrDefault({ color: null })).toBe('#0089ff');
        expect(cueColorOrDefault(null, '#ffd400')).toBe('#ffd400');
    });
});