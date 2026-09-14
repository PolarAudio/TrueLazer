// speedTarget.js
// Dual target-speed calculation engine.
//
// Replaces the previous single "FPS" model with two complementary approaches:
//
//   Mode A — VARIABLE FPS -> FIXED PPS  (DEFAULT)
//       Given a fixed target PPS (per-channel, from hardwarePresets), adapt the
//       per-frame point budget so the DAC always consumes a stable PPS. Frame
//       rate varies based on content complexity (more complex content = fewer
//       frames at the same PPS, or even point distribution per frame).
//
//   Mode B — VARIABLE PPS -> FIXED FPS
//       Given a fixed frame rate, compute the PPS needed to render the current
//       frame's points, then fill/reduce so the output stays at a stable FPS.
//
// In both modes the central relation is:
//
//      pointBudget = targetPPS / targetFPS
//
// This is the single source of truth for frame-buffer construction and replaces
// the previously hardcoded 1000-point budget.

export const TARGET_MODES = {
    VAR_FPS_FIXED_PPS: 'varFpsFixedPps', // DEFAULT
    VAR_PPS_FIXED_FPS: 'varPpsFixedFps',
};

// Reference hardware timing values from an equivalent laser application.
// Used to derive conservative per-point budgets and galvo settle guidance.
export const HW_TIMING = {
    drawSpeedUs: 200,          // time to fully deflect to a target point
    travelSpeedUsMin: 600,     // blanked travel time (safe)
    travelSpeedUsMax: 1500,    // blanked travel time (worst case)
    cornerSettleUs: 200,       // extra settle at sharp corners
    litHoldBeforeUs: 200,      // dwell before a lit point
    litHoldAfterUsMin: 65,
    litHoldAfterUsMax: 150,
    blankHoldBeforeUs: 0,
    blankHoldAfterUsMin: 200,
    blankHoldAfterUsMax: 600,
    dotDwell: 4,               // additional samples for isolated lit dots
    motionResponse: 0.5,       // galvo motion-response factor (0..1)
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const floorPositive = (v) => Math.max(1, Math.floor(v));

/**
 * Compute the fixed per-frame point budget for frame-buffer construction.
 *
 * @param {object} opts
 * @param {number} opts.targetPps   target points-per-second (Mode A) OR the
 *                                  aggregated PPS to hold (Mode B)
 * @param {number} opts.frameRate   reference frame rate in Hz
 * @param {boolean} [opts.min]      enforce a minimum budget floor
 * @returns {number} point budget (points per frame)
 */
export function computePointBudget({ targetPps, frameRate, min }) {
    const fps = clamp(frameRate && frameRate > 0 ? frameRate : 30, 1, 360);
    const pps = clamp(targetPps && targetPps > 0 ? targetPps : 30000, 1000, 120000);
    const budget = pps / fps;
    const floor = min && min > 0 ? min : 0;
    return Math.max(floor, Math.max(1, Math.round(budget)));
}

/**
 * Mode A default resolver. Returns the point budget for the current frame given
 * a fixed PPS target. FPS is free (varies), but we still need a reference FPS
 * for budgeting — use the UI playback rate as the reference frame rate.
 *
 * @param {number} targetPps
 * @param {number} referenceFps  UI main-thread frame rate (playbackFps)
 * @param {number} [minPoints]
 * @returns {{ mode:string, pointBudget:number, targetPps:number, referenceFps:number }}
 */
export function resolveVarFpsFixedPps(targetPps, referenceFps = 30, minPoints = 0) {
    const pps = clamp(targetPps && targetPps > 0 ? targetPps : 30000, 1000, 120000);
    const fps = clamp(referenceFps && referenceFps > 0 ? referenceFps : 30, 1, 360);
    return {
        mode: TARGET_MODES.VAR_FPS_FIXED_PPS,
        targetPps: pps,
        referenceFps: fps,
        pointBudget: computePointBudget({ targetPps: pps, frameRate: fps, min: minPoints }),
    };
}

/**
 * Mode B resolver. Given a fixed frame rate and a target PPS, returns the PPS
 * that the DAC must be configured for to hold that frame rate, plus the exact
 * point budget per frame. This is the "Variable PPS -> Fixed FPS" path where
 * the UI holds a stable frame rate while PPS rises/falls with content.
 *
 * @param {number} frameRate     fixed FPS
 * @param {number} targetPps     desired PPS ceiling
 * @param {number} [minPoints]
 * @returns {{ mode:string, targetPps:number, frameRate:number, pointBudget:number }}
 */
export function resolveVarPpsFixedFps(frameRate = 30, targetPps = 30000, minPoints = 0) {
    const fps = clamp(frameRate && frameRate > 0 ? frameRate : 30, 1, 360);
    const budget = computePointBudget({
        targetPps: targetPps > 0 ? targetPps : fps * 1000,
        frameRate: fps,
        min: minPoints,
    });
    // PPS required to render `budget` points at `fps` is exactly fps*budget.
    const pps = Math.round(budget * fps);
    return {
        mode: TARGET_MODES.VAR_PPS_FIXED_FPS,
        targetPps: pps,
        frameRate: fps,
        pointBudget: budget,
    };
}

/**
 * Resolve a per-channel/UI timing spec to a concrete point budget.
 * This is the entry point used by the frame-buffer construction path.
 *
 * @param {object} spec
 * @param {string} spec.mode
 * @param {number} spec.targetPps
 * @param {number} spec.targetFps
 * @param {number} spec.minPoints
 * @param {number} spec.referenceFps  UI fallback frame rate
 * @returns {{ mode:string, targetPps:number, frameRate:number, pointBudget:number }}
 */
export function resolveSpeedTarget(spec = {}) {
    const mode = spec.mode === TARGET_MODES.VAR_PPS_FIXED_FPS
        ? TARGET_MODES.VAR_PPS_FIXED_FPS
        : TARGET_MODES.VAR_FPS_FIXED_PPS;
    const referenceFps = clamp(spec.referenceFps && spec.referenceFps > 0 ? spec.referenceFps : 30, 1, 360);

    if (mode === TARGET_MODES.VAR_PPS_FIXED_FPS) {
        return resolveVarPpsFixedFps(
            spec.targetFps && spec.targetFps > 0 ? spec.targetFps : referenceFps,
            spec.targetPps,
            spec.minPoints,
        );
    }
    return resolveVarFpsFixedPps(spec.targetPps, referenceFps, spec.minPoints);
}

/**
 * Convert a point distance in -1..1 display units to a normalized per-sample
 * advance given a target PPS, used for the ILDA passthrough velocity ceiling.
 *
 * The scanner's physical max travel is a constant velocity: at 25kpps the beam
 * may travel at most 2 display-units per second (i.e. 2/25000 units per
 * sample). A fixed units-per-second limit means the per-sample ceiling is
 * velocity / pps, so it shrinks as the scan rate rises (more samples per
 * second each get less travel) and the resulting step*pps product stays a
 * constant velocity.
 *
 * @param {number} pps        output points per second
 * @param {number} [refUnitsPerSec=2]  display-units per second (constant velocity)
 * @param {number} [refPps=25000]      reference rate the units/sec value assumes
 * @returns {number} maximum allowed advance per sample (display units)
 */
export function computePassthroughStepCeiling(pps, refUnitsPerSec = 2, refPps = 25000) {
    const p = clamp(pps && pps > 0 ? pps : 25000, 1000, 120000);
    const unitsPerSec = refUnitsPerSec > 0 ? refUnitsPerSec : 2;
    // Reference ceiling at refPps is unitsPerSec/refPps per sample; rescale so
    // the velocity (step * pps) equals unitsPerSec regardless of pps.
    return (unitsPerSec / refPps) * (refPps / p);
}

export default {
    TARGET_MODES,
    HW_TIMING,
    computePointBudget,
    resolveVarFpsFixedPps,
    resolveVarPpsFixedFps,
    resolveSpeedTarget,
    computePassthroughStepCeiling,
};
