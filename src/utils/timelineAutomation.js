import { effectDefinitions } from './effectDefinitions';
import { generatorDefinitions } from './generatorDefinitions';

/**
 * Timeline automation: Bezier keyframe evaluation + scalar transforms applied
 * to the app's canonical 8-float frame layout:
 *   Float32Array [x, y, z, r, g, b, blanking, lastPoint]
 *
 * Lanes are normalized entities that target one "property". The engine bakes
 * the evaluated lane value into a copy of a compiled frame without mutating the
 * pristine cached source frame (non-destructive like the spec's
 * globalProcessingBuffer).
 *
 * Modern lanes link to ONE parameter of ONE main-app effect
 * (effectDefinitions): `lane.effectId` + `lane.paramId` choose what the lane's
 * keyframes drive, and the channel compile stage feeds the merged effect list
 * through `applyEffects` (utils/effects). Legacy lanes that were saved with a
 * bare `targetProperty` (the old fixed Scale/Rotation/Translate/Brightness/Color
 * scalars) still evaluate through `applyLanesToPoints` so old projects keep
 * working unchanged — no destructive migration.
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

/**
 * Resolve the effect definition a lane is linked to (or null when the lane is
 * empty / unassigned / references an unknown effect id).
 */
export function getLaneEffectDef(lane) {
    if (!lane?.effectId) return null;
    return effectDefinitions.find((d) => d.id === lane.effectId) || null;
}

/**
 * Resolve the parameter control a lane drives within its effect. Returns the
 * paramControl object, or null when the lane is unassigned, the param doesn't
 * exist, or the param is not continuous 'range' type (selects/checkboxes/color
 * pickers cannot be driven by a keyframe curve).
 */
export function getLaneParam(lane) {
    const def = getLaneEffectDef(lane);
    if (!def || !lane.paramId) return null;
    const ctrl = (def.paramControls || []).find((c) => c.id === lane.paramId);
    return ctrl && ctrl.type === 'range' ? ctrl : null;
}

/** The keyframe curve's default value for a lane (what an empty curve holds). */
export function laneDefaultValue(lane) {
    const genCtrl = getLaneGenParam(lane);
    if (genCtrl) {
        if (typeof genCtrl.def === 'number' && isFinite(genCtrl.def)) return genCtrl.def;
        if (typeof genCtrl.min === 'number' && typeof genCtrl.max === 'number') return (genCtrl.min + genCtrl.max) / 2;
        return 0;
    }
    const ctrl = getLaneParam(lane);
    if (ctrl) {
        if (typeof ctrl.def === 'number' && isFinite(ctrl.def)) return ctrl.def;
        const def = getLaneEffectDef(lane);
        const d = def?.defaultParams && def.defaultParams[lane.paramId];
        if (typeof d === 'number' && isFinite(d)) return d;
        if (typeof ctrl.min === 'number' && typeof ctrl.max === 'number') return (ctrl.min + ctrl.max) / 2;
        return 1;
    }
    const target = getLaneTarget(lane?.targetProperty);
    return target.defaultValue;
}

/** Evaluate an effect-linked lane's value at `time` (falls back to the param default). */
export function evaluateLaneForEffect(lane, time) {
    return evaluateKeyframes(lane?.keyframes, time, laneDefaultValue(lane));
}

/**
 * Build the ordered effects array for a channel from its lanes at `time`.
 * Lanes that share an effect id are merged into one effect instance whose
 * params carry every automated value; non-automated params keep the effect's
 * registered defaults. instanceId is per-channel-plus-effect so stateful
 * effects (delay/chase history, continuous phase) never leak across channels.
 */
export function buildChannelEffects(lanes = [], time, channelId = '') {
    const byEffect = new Map();
    for (const lane of lanes || []) {
        const ctrl = getLaneParam(lane);
        if (!ctrl) continue;
        let eff = byEffect.get(lane.effectId);
        if (!eff) {
            const def = getLaneEffectDef(lane);
            eff = {
                id: lane.effectId,
                instanceId: `auto.${channelId || ''}.${lane.effectId}`,
                params: { ...(def?.defaultParams || {}) },
            };
            byEffect.set(lane.effectId, eff);
        }
        eff.params[lane.paramId] = evaluateLaneForEffect(lane, time);
    }
    return [...byEffect.values()];
}

// ---------------------------------------------------------------------------
// Generator-parameter lanes: drive a GENERATOR cue's params (circle radius,
// square width, sine frequency, ...) from a channel automation curve. Additive
// to the effect lanes — a channel can own both kinds of automation lane.
// ---------------------------------------------------------------------------

/** Resolve the paramControl a generator lane drives, or null if not animatable. */
export function getLaneGenParam(lane) {
    if (!lane?.genId || !lane?.genParamId) return null;
    const def = generatorDefinitions.find((d) => d.id === lane.genId);
    if (!def) return null;
    const ctrl = (def.paramControls || []).find((c) => c.id === lane.genParamId);
    return ctrl && ctrl.type === 'range' ? ctrl : null;
}

/** The generator definition a lane is linked to (or null). */
export function getLaneGenDef(lane) {
    if (!lane?.genId) return null;
    return generatorDefinitions.find((d) => d.id === lane.genId) || null;
}

/** Evaluate a generator lane at `time`; an empty curve holds `baseValue`. */
export function evaluateGenLane(lane, time, baseValue) {
    return evaluateKeyframes(lane?.keyframes, time, baseValue);
}

/**
 * Build the generator-param overrides for a cue at `time`. Only lanes whose
 * generator matches the active cue's generator id apply; the base value of an
 * empty curve is the clip's own slider value, so an untouched curve changes
 * nothing. Returns null when no lane drives this generator.
 */
export function buildGeneratorOverrides(lanes = [], time, genId, baseParams = {}) {
    let out = null;
    for (const lane of lanes || []) {
        if (!getLaneGenParam(lane)) continue;
        if (lane.genId !== genId) continue;
        if (!out) out = {};
        const hasBase = baseParams != null && Object.prototype.hasOwnProperty.call(baseParams, lane.genParamId);
        const base = hasBase ? baseParams[lane.genParamId] : laneDefaultValue(lane);
        out[lane.genParamId] = evaluateGenLane(lane, time, base);
    }
    return out;
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

/** Clamp a value to [lo, hi]. */
export function clampNumber(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Build absolute-space control points for the segment A -> B.
 *
 * Priority: tension (FL-studio drag handle) overrides any preset `easing`,
 * which overrides the raw handleIn/handleOut pairs.
 */
function segmentControlPoints(a, b) {
    const dt = b.time - a.time;
    const dv = b.value - a.value;

    // Tension: a single drag handle on the segment's midline bows the curve
    // symmetrically around the straight chord. t=0 is linear; t>0 bows UP
    // (whole curve above the chord), t<0 bows DOWN. With yOut/yIn mirroring
    // around 1/3, the control points stay inside the chord triangle so the
    // curve is monotonic and truly bows (a mirrored-identical pair cancels out
    // and would leave a straight line).
    if (typeof a?.tension === 'number' && isFinite(a.tension)) {
        const t = clampNumber(a.tension, -1, 1);
        const yOut = (1 / 3) + t * (1 / 3); // 0..2/3: elevation of the outgoing control point
        const yIn = (1 / 3) - t * (1 / 3);  // 0..2/3: opposite pull on the incoming side
        return {
            x1: a.time + (1 / 3) * dt,
            y1: a.value + yOut * dv,
            x2: b.time - (1 / 3) * dt,
            y2: b.value - yIn * dv,
        };
    }

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
            // Hold: keep A's value across the whole span, then jump at B.
            if (a?.easing === 'hold') {
                return time < b.time ? a.value : b.value;
            }
            const segment = segmentControlPoints(a, b);
            const sameValue = Math.abs(b.value - a.value) < 1e-9;
            if (sameValue && Math.abs(b.time - a.time) < 1e-9) return b.value;
            return solveBezierValue(time, a, segment, b);
        }
    }
    return last.value;
}

/** Evaluate a whole lane at `time`. Effect-linked lanes use the param default; legacy bare-target lanes use the built-in target's default. */
export function evaluateLane(lane, time) {
    if (lane?.effectId && lane?.paramId) return evaluateLaneForEffect(lane, time);
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
    const keyframes = (lane?.keyframes || []).slice().sort((x, y) => x.time - y.time);
    if (keyframes.length === 0) return null;
    const defaultValue = laneDefaultValue(lane);
    const t0 = keyframes[0].time;
    const t1 = keyframes.length > 1 ? keyframes[keyframes.length - 1].time : duration;
    const span = Math.max(1e-6, t1 - t0);
    const min = Math.min(...keyframes.map((k) => k.value), defaultValue);
    const max = Math.max(...keyframes.map((k) => k.value), defaultValue);
    const vSpan = Math.max(1e-6, max - min);
    const x = (t) => ((t - t0) / span) * width;
    const y = (v) => (1 - (v - min) / vSpan) * height;

    const segments = [];
    for (let i = 0; i < keyframes.length - 1; i++) {
        const a = keyframes[i];
        const b = keyframes[i + 1];
        if (a?.easing === 'hold') {
            // Step curve: hold A's value across the span, then a vertical jump.
            segments.push(
                `M ${x(a.time).toFixed(2)} ${y(a.value).toFixed(2)} L ${x(b.time).toFixed(2)} ${y(a.value).toFixed(2)}`
            );
            continue;
        }
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