import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { clipBlockStyle } from './timelineClipColor';

// Guards the reported bug: overlapping clips rendered as nothing but stripes.
// `.ilda` / `.generator` set the `background` SHORTHAND in index.css and
// `.overlap` used to set `background-image` on the same element, which REPLACES
// the shorthand's image component. The stripes now live on `::before`.
describe('timeline block colour + overlap classes', () => {
    const style = clipBlockStyle({ color: '#ff8800' });

    it('layers overlap marking without touching the block background', () => {
        // The invariant the fix rests on: the element itself never carries a
        // background-image, so the CSS shorthand keeps the clip's own gradient.
        expect(style).not.toBeNull();
        expect(style.background).not.toBe('none');
        expect(style.background).not.toContain('repeating-linear-gradient');
    });

    it('supplies no background at all when the cue is uncoloured', () => {
        // Returning a style here would inline a background and override the
        // type-based default for every existing clip.
        expect(clipBlockStyle({})).toBeNull();
    });

    it('produces a distinct colour per clip', () => {
        const a = clipBlockStyle({ color: '#ff0000' });
        const b = clipBlockStyle({ color: '#0000ff' });
        expect(a.background).not.toBe(b.background);
    });
});