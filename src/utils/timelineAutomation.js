/**
 * Timeline automation: Bezier keyframe evaluation + scalar transforms applied
 * to the app's canonical 8-float frame layout:
 *   Float32Array [x, y, z, r, g, b, blanking, lastPoint]
 *
 * Lanes are normalized entities that target one "property". The engine bakes
 * the evaluated lane value into a copy of a compiled frame without mutating the
 * pristine cached source frame (non-destructive like the spec's
 * globalProcessingBuffer).
 */
export const POINT_STRIDE = 8;

/** The automation targets the lanes/engine understand today. */
export const LANE_TARGETS = [
    { id: 'GEOMETRY_SCALE', label: 'Scale', unit: 'x', defaultValue: 1 },          // 1 = native size
    { id: 'GEOMETRY_ROTATION', label: 'Rotation', unit: 'deg', defaultValue: 0 },  // degrees
    { id: 'GEOMETRY_TRANSLATION_X', label: 'Translate X', unit: 'u', defaultValue: 0 },
    { id: 'GEOMETRY_TRANSLATION_Y', label: 'Translate Y', unit: 'u', defaultValue: 0 },
    { id: 'COLOR_MAX_BRIGHTNESS', label: 'Brightness', unit: 'x', defaultValue: 1 },
    { id: 'COLOR_RED', label: 'Red', unit: 'x', defaultValue: 1 },
    { id: 'COLOR_GREEN', label: 'Green', unit: 'x', defaultValue: 1 },
    { id: 'COLOR_BLUE', label: 'Blue', unit: 'x', defaultValue: 1 },
];

export function getLaneTarget(id) {
    return LANE_TARGETS.find((t) => t.id === id) || LANE_TARGETS[0];
}

// Named easing curves as normalized cubic-bezier control pairs (x1,y1,x2,y2).
const EASING_PRESETS = {
    linear: null,
    ease: [0.42, 0, 0.58, 1],
    easeIn: [0.42, 0, 1, 1],
    easeOut: [0, 0, 0.58, 1],
    easeInOut: [0.42, 0, 0.58, 1],
};

/**
 * Parse a "bezier(x1, y1, x2, y2)" easing string into normalized control
 * offsets, or resolve a named preset. Returns null for linear.
 */
export function resolveEasing(easing) {
    if (!easing || easing === 'linear') return null;
    if (typeof easing === 'string') {
        if (easing.startsWith('bezier(')) {
            const parts = easing
                .slice(7, -1)
                .split(',')
                .map((p) => parseFloat(p));
            if (parts.length === 4 && parts.every((n) => isFinite(n))) {
                return parts;
            }
            return null;
        }
        return EASING_PRESETS[easing] || null;
    }
    if (Array.isArray(easing) && easing.length === 4) return easing;
    return null;
}

function cubicPoint(t, p0, p1, p2, p3, axis) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return p0[axis] * mt2 * mt + 3 * p1[axis] * mt2 * t + 3 * p2[axis] * mt * t2 + p3[axis] * t2 * t;
}

/**
 * Given an absolute-space cubic segment {x1,y1,x2,y2} connecting keyframe A
 * (time,value) to keyframe B, find the curve parameter t at which the curve's
 * X equals `time`, then return the Y value at that t. Newton iterations with a
 * binary-search fallback keep t monotonic.
 */
function solveBezierValue(time, a, segment, b) {
    const p0 = { x: a.time, y: a.value };
    const p1 = { x: segment.x1, y: segment.y1 };
    const p2 = { x: segment.x2, y: segment.y2 };
    const p3 = { x: b.time, y: b.value };
    const span = p3.x - p0.x;
    if (Math.abs(span) < 1e-9) return p3.y;

    let t = (time - p0.x) / span;

    // Newton iteration (t clamped, early exit on convergence)
    for (let i = 0; i < 12; i++) {
        t = Math.max(0, Math.min(1, t));
        const mt = 1 - t;
        const x = cubicPoint(t, p0, p1, p2, p3, 'x');
        const dx = 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
        if (Math.abs(dx) < 1e-9) break;
        const next = t - (x - time) / dx;
        if (Math.abs(next - t) < 1e-6) {
            t = next;
            break;
        }
        t = next;
    }

    // Binary-search fallback for pathological control points
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (cubicPoint(mid, p0, p1, p2, p3, 'x') < time) lo = mid;
        else hi = mid;
        if (Math.abs(cubicPoint(mid, p0, p1, p2, p3, 'x') - time) < 1e-7) break;
    }
    if (Math.abs(cubicPoint((lo + hi) / 2, p0, p1, p2, p3, 'x') - time) < Math.abs(cubicPoint(t, p0, p1, p2, p3, 'x') - time)) {
        t = (lo + hi) / 2;
    }

    t = Math.max(0, Math.min(1, t));
    return cubicPoint(t, p0, p1, p2, p3, 'y');
}

/** Build absolute-space control points for the segment A -> B. */
function segmentControlPoints(a, b) {
    const dt = b.time - a.time;
    const dv = b.value - a.value;
    const easing = resolveEasing(a?.easing);
    if (easing) {
        return {
            x1: a.time + easing[0] * dt,
            y1: a.value + easing[1] * dv,
            x2: a.time + easing[2] * dt,
            y2: a.value + easing[3] * dv,
        };
    }
    const hOut = a?.handleOut || [1 / 3, 1 / 3];
    const hIn = b?.handleIn || [1 / 3, 1 / 3];
    return {
        x1: a.time + hOut[0] * dt,
        y1: a.value + hOut[1] * dv,
        x2: b.time - hIn[0] * dt,
        y2: b.value - hIn[1] * dv,
    };
}

/**
 * Evaluate a lane's value at `time`.
 * - No keyframes -> `defaultValue`
 * - Before/after ends -> first/last keyframe value
 * - Otherwise Bezier/linear interpolation between the bracketing keyframes
 */
export function evaluateKeyframes(keyframes, time, defaultValue = 1) {
    if (!Array.isArray(keyframes) || keyframes.length === 0) return defaultValue;
    const sorted = [...keyframes].sort((x, y) => x.time - y.time);
    if (time <= sorted[0].time) return sorted[0].value;
    const last = sorted[sorted.length - 1];
    if (time >= last.time) return last.value;

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (time >= a.time && time <= b.time) {
            const segment = segmentControlPoints(a, b);
            const sameValue = Math.abs(b.value - a.value) < 1e-9;
            if (sameValue && Math.abs(b.time - a.time) < 1e-9) return b.value;
            return solveBezierValue(time, a, segment, b);
        }
    }
    return last.value;
}

/** Evaluate a whole lane at `time`. */
export function evaluateLane(lane, time) {
    const target = getLaneTarget(lane?.targetProperty);
    return evaluateKeyframes(lane?.keyframes, time, target.defaultValue);
}

/**
 * Copy `points` and apply scalar geometry/color transforms. Never mutates the
 * source. Geometry is applied around the origin (0,0) in unit space, which
 * matches the app's generators and ILDA data.
 */
export function transformFrame(points, {
    scale = 1,
    rotationDeg = 0,
    translateX = 0,
    translateY = 0,
    brightness = 1,
    red = 1,
    green = 1,
    blue = 1,
} = {}) {
    if (!points) return points;
    const count = points.length / POINT_STRIDE;
    const out = new Float32Array(points);
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const applyColor = brightness !== 1 || red !== 1 || green !== 1 || blue !== 1;

    for (let i = 0; i < count; i++) {
        const o = i * POINT_STRIDE;
        const x = points[o] * scale;
        const y = points[o + 1] * scale;
        out[o] = x * cos - y * sin + translateX;
        out[o + 1] = x * sin + y * cos + translateY;
        if (applyColor) {
            // Color channels are 0..255 here (8-bit frame convention). Automation
            // boosts (e.g. brightness × 2) must not escape that range — saturating
            // at 255 is full power and keeps downstream 8-bit DAC bytes in bounds.
            out[o + 3] = clamp255(points[o + 3] * red * brightness);
            out[o + 4] = clamp255(points[o + 4] * green * brightness);
            out[o + 5] = clamp255(points[o + 5] * blue * brightness);
        }
    }
    return out;
}

/** Clamp an 8-bit color channel to 0..255. */
export function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Evaluate every lane at `time` and bake all accumulated values into a copy of
 * `points`. Scale/brightness multiply (so two scale lanes compound), rotation/
 * translation add.
 */
export function applyLanesToPoints(points, lanes, time) {
    const acc = {
        scale: 1,
        rotationDeg: 0,
        translateX: 0,
        translateY: 0,
        brightness: 1,
        red: 1,
        green: 1,
        blue: 1,
    };
    for (const lane of lanes || []) {
        const value = evaluateLane(lane, time);
        switch (lane?.targetProperty) {
            case 'GEOMETRY_SCALE': acc.scale *= value; break;
            case 'GEOMETRY_ROTATION': acc.rotationDeg += value; break;
            case 'GEOMETRY_TRANSLATION_X': acc.translateX += value; break;
            case 'GEOMETRY_TRANSLATION_Y': acc.translateY += value; break;
            case 'COLOR_MAX_BRIGHTNESS': acc.brightness *= value; break;
            case 'COLOR_RED': acc.red *= value; break;
            case 'COLOR_GREEN': acc.green *= value; break;
            case 'COLOR_BLUE': acc.blue *= value; break;
            default: break;
        }
    }
    return transformFrame(points, acc);
}

/** Build an SVG path string for a lane's curve across `duration`. */
export function laneSvgPath(lane, duration, { width = 1000, height = 100, padding = 8 } = {}) {
    const target = getLaneTarget(lane?.targetProperty);
    const keyframes = (lane?.keyframes || []).slice().sort((x, y) => x.time - y.time);
    if (keyframes.length === 0) return null;
    const t0 = keyframes[0].time;
    const t1 = keyframes.length > 1 ? keyframes[keyframes.length - 1].time : duration;
    const span = Math.max(1e-6, t1 - t0);
    const min = Math.min(...keyframes.map((k) => k.value), target.defaultValue);
    const max = Math.max(...keyframes.map((k) => k.value), target.defaultValue);
    const vSpan = Math.max(1e-6, max - min);
    const x = (t) => ((t - t0) / span) * width;
    const y = (v) => (1 - (v - min) / vSpan) * height;

    const segments = [];
    for (let i = 0; i < keyframes.length - 1; i++) {
        const a = keyframes[i];
        const b = keyframes[i + 1];
        const seg = segmentControlPoints(a, b);
        const cx1 = ((seg.x1 - t0) / span) * width;
        const cy1 = y(seg.y1);
        const cx2 = ((seg.x2 - t0) / span) * width;
        const cy2 = y(seg.y2);
        segments.push(
            `M ${x(a.time).toFixed(2)} ${y(a.value).toFixed(2)} ` +
            `C ${cx1.toFixed(2)} ${cy1.toFixed(2)}, ${cx2.toFixed(2)} ${cy2.toFixed(2)}, ${x(b.time).toFixed(2)} ${y(b.value).toFixed(2)}`
        );
    }
    if (keyframes.length === 1) {
        const val = keyframes[0].value;
        segments.push(`M 0 ${y(val).toFixed(2)} L ${width} ${y(val).toFixed(2)}`);
    }
    return segments.join(' ');
}