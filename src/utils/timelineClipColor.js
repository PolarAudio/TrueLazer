// Per-clip colouring for the Timeline track blocks.
//
// Clips have always had two default looks - ILDA blue and generator amber -
// defined in `index.css` as `background` shorthand + border colour. This module
// only ever *overrides* them: a cue with no colour keeps exactly the appearance
// it had before this feature existed, which also means every clip saved in an
// older project file renders unchanged.
//
// The generated gradients are deliberately semi-transparent, matching the CSS
// defaults. The blocks sit on a dark lane, so a translucent tint keeps the light
// label text legible whatever hue the user picks, instead of having to compute a
// contrasting foreground colour.

/** Parse #rgb / #rrggbb (and the rgb()/rgba() forms browsers round-trip through). */
export function parseHex(color) {
    if (typeof color !== 'string') return null;
    let c = color.trim().toLowerCase();
    if (c.startsWith('#')) c = c.slice(1);
    else if (c.startsWith('rgb')) {
        const nums = c.match(/[\d.]+/g);
        if (nums && nums.length >= 3) {
            return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
        }
        return null;
    }
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    if (c.length !== 6 || !/^[0-9a-f]{6}$/.test(c)) return null;
    return [
        parseInt(c.slice(0, 2), 16),
        parseInt(c.slice(2, 4), 16),
        parseInt(c.slice(4, 6), 16),
    ];
}

/** Hex colour + alpha -> rgba() string. Returns null for an unparseable colour. */
export function toRgba(color, alpha) {
    const rgb = parseHex(color);
    if (!rgb) return null;
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

/**
 * Inline style for a timeline block, or null when the cue has no colour of its
 * own and should fall back to the CSS default for its type.
 *
 * Matching the CSS defaults' alpha values keeps a custom-coloured clip sitting
 * at the same visual weight as an uncoloured one.
 */
export function clipBlockStyle(cue) {
    if (!cue || !cue.color) return null;
    const top = toRgba(cue.color, 0.42);
    const bottom = toRgba(cue.color, 0.28);
    const border = toRgba(cue.color, 0.55);
    // An unparseable value must not blank the clip out.
    if (!top || !bottom || !border) return null;
    return {
        background: `linear-gradient(180deg, ${top}, ${bottom})`,
        borderColor: border,
    };
}

/** A representative colour for a cue, for pickers and swatches. */
export function cueColorOrDefault(cue, fallback = '#0089ff') {
    return (cue && cue.color) || fallback;
}