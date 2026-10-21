// Resampling a path so that no segment is longer than a maximum step.
//
// A laser DAC physically cannot draw a line between two points. The galvo
// flies from one sample to the next, and the beam is only on while a lit
// sample is commanded. A path whose segments are longer than the scanner can
// resolve therefore renders as a chain of discrete dots, and a path with only
// a handful of lit samples is dim to the point of being invisible: a two
// point line is on the beam for 2 samples out of a 575 point frame, which is
// about 0.07 ms of a 19 ms frame.
//
// Resampling the path to a maximum step is what turns it back into a line.
// This is a correctness requirement of the output, not an optimization, so it
// runs on the DAC path whether or not point optimization is enabled.
//
// Two shapes of the same problem live here:
//   * resampleFrameToStep  - a DAC frame (8 floats per point, with blanking),
//                            used on the playback path;
//   * resamplePolyline    - an editor-space polyline, used by the export so a
//                            written .ild file is laser-grade on its own.

// The step the DAC optimizer has always used, in display units (1.0 = the full
// field width). Kept in one place so the export and the playback path agree.
export const DEFAULT_MAX_STEP = 0.02;

// The editor works in a 0..1000 pixel space and the DAC works in -1..1, so
// 500 editor pixels is one display unit.
export const EDITOR_PX_PER_DISPLAY_UNIT = 500;

// The same step expressed in editor pixels.
export const DEFAULT_MAX_STEP_PX = DEFAULT_MAX_STEP * EDITOR_PX_PER_DISPLAY_UNIT;

const FLOATS_PER_POINT = 8;

// A segment that is exactly the step long must not be subdivided again: the
// export samples at the same step the DAC path does, and the two stages would
// otherwise fight over every segment.
//
// The tolerance is ABSOLUTE, in the unit of the step, and sized for the noise
// a Float32 frame carries: a coordinate in -1..1 stored as a Float32 is off by
// up to ~6e-8, so a segment length is off by up to ~1.2e-7. A relative
// epsilon would be far too small to catch that, because the error scales
// with the coordinate magnitude rather than with the length of the segment.
const STEP_TOLERANCE = 1e-6;

const lerp = (a, b, t) => a + (b - a) * t;

const hexToRgb = (value) => {
    if (typeof value !== 'string') return null;
    const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const packed = parseInt(match[1], 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
};

const rgbToHex = (rgb) =>
    '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');

const readPoint = (points, isTyped, index) => {
    if (isTyped) {
        const o = index * FLOATS_PER_POINT;
        return {
            x: points[o],
            y: points[o + 1],
            z: points[o + 2],
            r: points[o + 3],
            g: points[o + 4],
            b: points[o + 5],
            blanking: points[o + 6] === 1,
        };
    }
    const p = points[index] || {};
    return {
        x: p.x || 0,
        y: p.y || 0,
        z: p.z || 0,
        r: p.r || 0,
        g: p.g || 0,
        b: p.b || 0,
        blanking: !!p.blanking,
    };
};

const toTyped = (points, isTyped, numPoints) => {
    if (isTyped) return points;
    const out = new Float32Array(numPoints * FLOATS_PER_POINT);
    for (let i = 0; i < numPoints; i++) {
        const p = points[i] || {};
        const o = i * FLOATS_PER_POINT;
        out[o] = p.x || 0;
        out[o + 1] = p.y || 0;
        out[o + 2] = p.z || 0;
        out[o + 3] = p.r || 0;
        out[o + 4] = p.g || 0;
        out[o + 5] = p.b || 0;
        out[o + 6] = p.blanking ? 1 : 0;
        out[o + 7] = p.lastPoint ? 1 : 0;
    }
    return out;
};

/**
 * Resample a DAC frame so no lit-to-lit segment is longer than `maxStep`.
 *
 * Blank points are structural - they are the pen-up moves - so the path is
 * never interpolated across one. The last point of the frame keeps the
 * "last point" marker the ILDA and DAC writers expect.
 *
 * @param {Float32Array|Array} points  8 floats per point, or point objects
 * @param {number} maxStep             maximum segment, in display units
 * @param {number} maxPoints           point budget; the step is raised when
 *                                     the interpolated points would not fit
 * @returns {Float32Array}
 */
export function resampleFrameToStep(points, { maxStep = DEFAULT_MAX_STEP, maxPoints = Infinity } = {}) {
    if (!points) return new Float32Array(0);
    const isTyped = (points instanceof Float32Array) || points.isTypedArray;
    const numPoints = isTyped ? Math.floor(points.length / FLOATS_PER_POINT) : points.length;
    if (numPoints < 2) return toTyped(points, isTyped, numPoints);

    // A frame produced by a channel-based effect (delay/chase) is a
    // concatenation of per-DAC slices. Each slice has to be resampled on its
    // own, or the geometry pass would interpolate across DAC boundaries and
    // the downstream per-DAC offsets would point into the wrong points.
    if (isTyped && points._channelDistributions && points._channelDistributions.size > 0) {
        const dists = points._channelDistributions;
        const keys = Array.from(dists.keys()).sort((a, b) => dists.get(a).start - dists.get(b).start);
        const slices = [];
        const newDists = new Map();
        let outOffset = 0;
        for (const key of keys) {
            const d = dists.get(key);
            const start = Math.max(0, d.start);
            const end = Math.min(d.start + d.length, points.length);
            if (end <= start) continue;
            const resampled = resampleFrameToStep(points.subarray(start, end), { maxStep, maxPoints });
            if (resampled.length === 0) continue;
            newDists.set(key, { start: outOffset, length: resampled.length });
            slices.push(resampled);
            outOffset += resampled.length;
        }
        const out = new Float32Array(outOffset);
        let o = 0;
        for (const slice of slices) {
            out.set(slice, o);
            o += slice.length;
        }
        out._channelDistributions = newDists;
        return out;
    }

    const source = new Array(numPoints);
    let totalLength = 0;
    for (let i = 0; i < numPoints; i++) {
        source[i] = readPoint(points, isTyped, i);
    }
    for (let i = 1; i < numPoints; i++) {
        if (source[i].blanking || source[i - 1].blanking) continue;
        totalLength += Math.hypot(source[i].x - source[i - 1].x, source[i].y - source[i - 1].y);
    }

    // The interpolation adds roughly totalLength / step points, so the step
    // has to grow when the budget cannot hold them. When the source alone
    // already fills the budget there is no room to interpolate at all, and
    // the existing decimators take over from here.
    let step = maxStep;
    if (Number.isFinite(maxPoints)) {
        const room = maxPoints - numPoints;
        if (room <= 0) return toTyped(points, isTyped, numPoints);
        if (totalLength > 0) step = Math.max(maxStep, totalLength / room);
    }

    const out = [];
    const push = (p) => {
        out.push(p.x, p.y, p.z || 0, p.r || 0, p.g || 0, p.b || 0, p.blanking ? 1 : 0, 0);
    };

    for (let i = 0; i < numPoints; i++) {
        const current = source[i];
        if (i === 0) {
            push(current);
            continue;
        }
        const previous = source[i - 1];
        if (current.blanking || previous.blanking) {
            push(current);
            continue;
        }
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        const distance = Math.hypot(dx, dy);
        if (distance > step + STEP_TOLERANCE) {
            // ceil, not floor: the whole point of this pass is that no
            // segment is longer than the scanner can resolve.
            const steps = Math.ceil(distance / step);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                push({
                    x: previous.x + dx * t,
                    y: previous.y + dy * t,
                    z: lerp(previous.z || 0, current.z || 0, t),
                    r: lerp(previous.r || 0, current.r || 0, t),
                    g: lerp(previous.g || 0, current.g || 0, t),
                    b: lerp(previous.b || 0, current.b || 0, t),
                    blanking: false,
                });
            }
        }
        push(current);
    }

    const result = new Float32Array(out);
    if (result.length >= FLOATS_PER_POINT) {
        result[result.length - 1] = 1; // last point marker
    }
    return result;
}

/**
 * Resample an editor-space polyline so no segment is longer than `maxStep`.
 *
 * A closed outline also has its wrap-around segment subdivided, so the seam
 * where the shape closes is not left as one long jump. The first point is not
 * repeated at the end: the beam program adds that closing vertex itself.
 *
 * @param {Array} pts       points of { x, y, color? }
 * @param {number} maxStep  maximum segment, in editor pixels
 * @param {number} maxPoints point budget; the step is raised when the
 *                          interpolated points would not fit
 * @param {boolean} closed  whether the outline wraps back to its first point
 */
export function resamplePolyline(pts, { maxStep = DEFAULT_MAX_STEP_PX, maxPoints = Infinity, closed = false } = {}) {
    const n = pts ? pts.length : 0;
    if (n < 2) return pts ? pts.slice() : [];

    const segments = [];
    for (let i = 0; i < n - 1; i++) segments.push([pts[i], pts[i + 1]]);
    if (closed) segments.push([pts[n - 1], pts[0]]);

    let total = 0;
    for (const [a, b] of segments) {
        total += Math.hypot(b.x - a.x, b.y - a.y);
    }

    let step = maxStep;
    if (Number.isFinite(maxPoints)) {
        const room = maxPoints - n;
        if (room <= 0) return pts.slice();
        if (total > 0) step = Math.max(maxStep, total / room);
    }

    const interpolate = (a, b, t) => {
        const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const from = hexToRgb(a.color);
        const to = hexToRgb(b.color);
        if (from && to) {
            point.color = rgbToHex([lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)]);
        } else {
            point.color = a.color !== undefined ? a.color : b.color;
        }
        return point;
    };

    const out = [];
    for (let s = 0; s < segments.length; s++) {
        const [a, b] = segments[s];
        if (s === 0) out.push(a);
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        if (distance > step + STEP_TOLERANCE) {
            const steps = Math.ceil(distance / step);
            for (let i = 1; i < steps; i++) out.push(interpolate(a, b, i / steps));
        }
        // The closing vertex of a closed outline is added by the beam program,
        // so it is not emitted here - but the points leading up to it are.
        const isClosing = closed && s === segments.length - 1;
        if (!isClosing) out.push(b);
    }
    return out;
}
