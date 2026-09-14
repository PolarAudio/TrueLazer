// hardwarePresets.js
// Per-channel PPS/FPS hardware compatibility presets.
//
// Three tiers address different laser-system scanner limitations. Each preset
// defines a target PPS band and pre-loads the matching optimizer settings so
// lower-speed scanners get fewer aggregate points and higher-speed scanners can
// use denser interpolation.
//
// The DEFAULT preset is the "Common" (25-35k pps) band with the Variable
// FPS -> Fixed PPS calculation mode.

// Centralize optimizer defaults here so presets and the optimizer share one
// source of truth. These are the application defaults from the spec:
export const OPT_DEFAULTS = {
    blankingStart: 8,          // 0-30  lit->blank transition dwell
    blankingEnd: 10,           // 0-30  blank->lit transition dwell
    shift: 0,                  // -20..20  point-to-color timing shift
    shiftR: 0,                 // R channel shift
    shiftG: 0,                 // G channel shift
    shiftB: 0,                 // B channel shift
    anchorStart: 4,            // 0-20  start anchor dwell
    anchorEnd: 2,              // 0-20  end anchor dwell
    litDwellStart: 3,          // 0-10  lit segment start dwell
    litDwellEnd: 3,            // 0-10  lit segment end dwell
    interpDistance: 300,       // 0-1000  lit interpolation distance (0-1000 scale)
    cornerDwell: 6,            // 0-30
    cornerThreshold: 60,       // 0-120 (degrees)
    minPadding: 200,           // 0-1000  minimum points per frame
};

// Normalize the 0-1000 interpolation-distance scale into display units
// (-1..1, where 1000 ~ full width, i.e. 2.0 display units wide).
export const INTERP_SCALE = 2000; // 2.0 display units across the 0..1000 range? see below
// 0-1000 maps to full -1..1 width (2.0 units). Unit step = 2.0/1000 = 0.002.
// Lit interpolation distance in -1..1 display units:
export const interpToDisplayUnits = (dist1000) => {
    const d = (dist1000 == null ? OPT_DEFAULTS.interpDistance : dist1000);
    return Math.max(0.0005, (d / 1000) * 2.0);
};

// Convert degrees (0-120) to the cosine used by the corner detector.
export const cornerDegreesToCos = (deg) => {
    const theta = Math.min(120, Math.max(0, (deg == null ? OPT_DEFAULTS.cornerThreshold : deg)));
    return Math.cos((theta * Math.PI) / 180);
};

/**
 * The optimizer settings that ship with each hardware preset.
 */
const PRESET_OPTIMIZER = {
    // Slow systems: 15-20k pps. Sparse interpolation so the galvos aren't asked
    // to move further per sample than they can track; more start/end anchor and
    // blanking dwell for stability at low speeds.
    slow: {
        targetPps: 17500,
        ppsBand: [15000, 20000],
        optimizer: {
            blankingStart: 10,
            blankingEnd: 12,
            shift: 0,
            shiftR: 0,
            shiftG: 0,
            shiftB: 0,
            anchorStart: 6,
            anchorEnd: 3,
            litDwellStart: 4,
            litDwellEnd: 4,
            interpDistance: 450,
            cornerDwell: 8,
            cornerThreshold: 60,
            minPadding: 200,
        },
    },
    // Common systems: 25-35k pps (DEFAULT). Balanced settings = app defaults.
    common: {
        targetPps: 30000,
        ppsBand: [25000, 35000],
        optimizer: { ...OPT_DEFAULTS },
    },
    // Fast systems: 35k+ pps. Dense interpolation for smooth high-speed traces;
    // reduced anchor/blanking dwell (speed itself provides brightness stability).
    fast: {
        targetPps: 40000,
        ppsBand: [35000, 60000],
        optimizer: {
            blankingStart: 6,
            blankingEnd: 8,
            shift: 0,
            shiftR: 0,
            shiftG: 0,
            shiftB: 0,
            anchorStart: 2,
            anchorEnd: 1,
            litDwellStart: 2,
            litDwellEnd: 2,
            interpDistance: 220,
            cornerDwell: 6,
            cornerThreshold: 60,
            minPadding: 200,
        },
    },
};

export const HARDWARE_PRESETS = {
    slow: 'slow',   // 15-20k pps
    common: 'common', // 25-35k pps (default)
    fast: 'fast',   // 35k+ pps
};

export const DEFAULT_PRESET = HARDWARE_PRESETS.common;

export const PRESET_ORDER = [
    { id: HARDWARE_PRESETS.slow, label: 'Slow (15-20k pps)' },
    { id: HARDWARE_PRESETS.common, label: 'Common (25-35k pps)' },
    { id: HARDWARE_PRESETS.fast, label: 'Fast (35k+ pps)' },
];

/**
 * Return the preset definition for a preset id (falls back to common).
 */
export function getPreset(presetId) {
    if (presetId && PRESET_OPTIMIZER[presetId]) return PRESET_OPTIMIZER[presetId];
    return PRESET_OPTIMIZER[DEFAULT_PRESET];
}

/**
 * Merge a hardware preset's optimizer settings over the user's explicit
 * overrides. Explicit overrides win (so users can tweak within a preset).
 *
 * @param {string} presetId
 * @param {object|null} overrides  explicit per-channel optimizer overrides
 * @returns {object} complete optimizer settings object
 */
export function getOptimizerSettings(presetId, overrides = null) {
    const preset = getPreset(presetId);
    return { ...preset.optimizer, ...(overrides || {}) };
}

/**
 * Resolve the target PPS for a channel. If the user has set an explicit
 * ppsTarget override, that wins; otherwise the preset band's nominal target
 * is used.
 */
export function resolveTargetPps({ preset = DEFAULT_PRESET, ppsOverride = null } = {}) {
    if (ppsOverride && ppsOverride > 0) return ppsOverride;
    return getPreset(preset).targetPps;
}

export default {
    OPT_DEFAULTS,
    INTERP_SCALE,
    HARDWARE_PRESETS,
    DEFAULT_PRESET,
    PRESET_ORDER,
    getPreset,
    getOptimizerSettings,
    resolveTargetPps,
    interpToDisplayUnits,
    cornerDegreesToCos,
};
