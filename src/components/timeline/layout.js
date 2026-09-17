// Shared metrics for the Timeline window layout.
export const HEADER_W = 240; // left column (track headers)
export const RULER_H = 30; // top ruler strip height
// Block row min height must fit the full track header: name row, M/S/X/Y +
// intensity row, and the DAC output chip row (~84px at current paddings).
export const BLOCK_ROW_H = 84; // height of the cue block strip in a channel row
export const AUTO_ROW_H = 64; // height of one automation lane strip
export const END_PAD = 96; // extra empty space at the end of the timeline
export const ZOOM_MIN = 8;
export const ZOOM_MAX = 600;