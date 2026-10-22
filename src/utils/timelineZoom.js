// The Timeline's zoom maths.
//
// Zooming has to keep the PLAYHEAD where it is on screen. The playhead's
// screen position is
//
//     headerWidth + playheadSec * zoom - scrollLeft
//
// so holding it still across a zoom change means
//
//     scrollLeft' = scrollLeft + playheadSec * (newZoom - oldZoom)
//
// It used to be done in one place only, with the playhead captured in a
// useCallback whose dependency list did not include it - so the anchor was the
// playhead position at the PREVIOUS zoom, not the current one. While the
// transport was running the playhead moved and the error was a frame wide;
// while it was stopped the first notch of every zoom gesture anchored on
// wherever the playhead had been the last time the zoom changed, which could
// be minutes earlier. That is why it "worked while playing" and did not
// while stopped.

/** Clamp a zoom into the range the timeline allows. */
export function clampZoomValue(zoom, { min, max }) {
    const value = Number(zoom);
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

/**
 * The scroll position that keeps the playhead at the same place on screen.
 *
 * The header width cancels out - it is added to the playhead's screen
 * position either way - so it does not appear here.
 */
export function playheadScrollCorrection({
    playheadSec = 0,
    oldZoom = 0,
    newZoom = 0,
    scrollLeft = 0,
} = {}) {
    const t = Number(playheadSec) || 0;
    return (Number(scrollLeft) || 0) + t * ((Number(newZoom) || 0) - (Number(oldZoom) || 0));
}

/**
 * The zoom factor for a wheel notch.
 *
 * Scroll up (negative deltaY) zooms IN, which is what a wheel is expected to
 * do. The factor is applied to the current zoom rather than to a fixed
 * step, so the zoom is continuous rather than jumping between stops.
 */
export function zoomFactorForWheel(deltaY) {
    const delta = Number(deltaY) || 0;
    return Math.pow(1.0015, -delta);
}
