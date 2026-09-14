import { effectDefinitions } from './effectDefinitions';
import { reduceFramePoints } from './pointReducer';

// Hard safety cap for the per-frame effect pipeline. Effects that multiply
// points (mirror additive, delay/chase in frame mode) compound multiplicatively,
// so a mirror×N + delay stack can run away to six-figure point counts and blow
// past every consumer's assumptions ("out of range", giant allocations). No DAC
// budget (~pps/fps, ~1000 at 30kpps/30fps, ILDA frames ≤ 4000) can ever render
// beyond this, so capping early loses no visible output — it only stops the
// runaway. `reduceFramePoints` is shape-preserving: blanks, corner dwell and
// lit-run structure survive the reduction.
export const MAX_EFFECT_POINTS = 16000;

// Per-frame point budget used to bound frame-mode delay output. Frame mode
// concatenates ~numPoints per echo, so steps>5 on a dense frame yields
// thousands of points that no DAC frame can digest — the send stage decimates
// to ~1k anyway, so the extra points are pure waste that inflates stats way
// over 100% (and formerly crashed the pipeline). The effect preserves the
// number of echoes and only trims per-echo fidelity when the concatenation
// would exceed this budget. Overridable per-call via context.framePointBudget.
export const DEFAULT_FRAME_POINT_BUDGET = 1000;

// X/Y axis pairs that stay in lockstep when the effect's `linkXY` flag is on:
// animating one axis also mirrors its resolved value onto the partner (unless
// the partner has its own speed-sync setting).
const linkedParamPairs = {};
for (const def of effectDefinitions) {
    if (!def.linkPairs) continue;
    linkedParamPairs[def.id] = linkedParamPairs[def.id] || {};
    for (const pair of def.linkPairs) {
        if (Array.isArray(pair) && pair.length === 2) {
            linkedParamPairs[def.id][pair[0]] = pair[1];
            linkedParamPairs[def.id][pair[1]] = pair[0];
        }
    }
}

// Cache definitions by ID for O(1) lookup
const definitionsById = effectDefinitions.reduce((acc, def) => {
    acc[def.id] = def;
    return acc;
}, {});

const withDefaults = (params, defaults) => {
    // Optimization: If params already contains all keys, avoid spreading
    // For now, keep it simple but avoid calling this in the tightest loops if possible
    return { ...defaults, ...params };
};

export function calculateAnimPhase(rawProgress, settings, baseValue, range) {
    const style = settings.style || 'loop';
    const direction = settings.direction || 'forward';
    if (direction === 'pause') return baseValue;

    let progress = rawProgress;
    if (style === 'bounce') {
        progress *= 2;
    }

    let animPhase = 0;
    if (style === 'once') {
        animPhase = Math.min(progress, 1.0);
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    } else if (style === 'bounce') {
        let localPhase = progress % 1.0;
        const lap = Math.floor(progress);
        if (lap % 2 === 1) animPhase = 1.0 - localPhase;
        else animPhase = localPhase;
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    } else {
        animPhase = progress % 1.0;
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    }

    if (range && Array.isArray(range) && range.length === 2) {
        return range[0] + (range[1] - range[0]) * animPhase;
    }

    return baseValue;
}

// Helper to resolve animated parameter values
export function resolveParam(key, baseValue, animSettings, context, minVal, maxValue) {
    if (!animSettings) return baseValue;

    // Handle legacy simple string mode or object mode
    const settings = typeof animSettings === 'string'
        ? { syncMode: animSettings }
        : animSettings;

    if (!settings.syncMode) return baseValue;

    const { time, progress = 0, bpm = 120, clipDuration = 0, fftLevels = { low: 0, mid: 0, high: 0 }, activationTime = 0 } = context;

    // Resolve range
    let range = settings.range;
    if (!range || !Array.isArray(range) || range.length !== 2) {
        if (minVal !== undefined && maxValue !== undefined) {
            range = [minVal, maxValue];
        }
    }

    let rawProgress = 0;

    // 1. Calculate Raw Progress (Unwrapped, 0..infinity)
    const speedMult = settings.speedMultiplier || 1.0;
    const style = settings.style || 'loop';

    if (style === 'once' && activationTime > 0) {
        // Special case for 'once': use absolute time since activation
        const elapsed = (time - activationTime) * 0.001; // seconds
        // Map elapsed to progress using duration logic
        let duration = 1.0;
        if (settings.syncMode === 'timeline') {
            duration = Math.max(0.01, settings.duration || 1.0);
        } else if (settings.syncMode === 'bpm') {
            const paramBeats = Math.max(0.1, settings.beats || 4);
            const bps = bpm / 60;
            duration = paramBeats / (bps || 2);
        } else if (settings.syncMode === 'fps') {
            rawProgress = elapsed * speedMult;
            return calculateAnimPhase(rawProgress, settings, baseValue, range);
        }

        rawProgress = (elapsed / duration) * speedMult;
    } else if (settings.syncMode === 'fps') {
        rawProgress = (time * 0.001 * speedMult);
    } else if (settings.syncMode === 'timeline') {
        const paramDur = Math.max(0.01, settings.duration || 1.0);
        if (clipDuration > 0) {
            const clipTime = progress * clipDuration;
            rawProgress = (clipTime / paramDur) * speedMult;
        } else {
            rawProgress = 0;
        }
    } else if (settings.syncMode === 'bpm') {
        const paramBeats = Math.max(0.1, settings.beats || 4);
        const bps = bpm / 60;
        const paramDur = paramBeats / (bps || 2);

        if (clipDuration > 0) {
            const clipTime = progress * clipDuration;
            rawProgress = (clipTime / paramDur) * speedMult;
        } else {
            rawProgress = 0;
        }
    } else if (settings.syncMode === 'fft') {
        const level = fftLevels[settings.fftRange || 'low'] || 0;
        if (range) return range[0] + (range[1] - range[0]) * level;
        return baseValue;
    }

    return calculateAnimPhase(rawProgress, settings, baseValue, range);
}

function resolveFftValue(level, baseValue, settings) {
    const range = settings.range;
    if (range && Array.isArray(range) && range.length === 2) {
        return range[0] + (range[1] - range[0]) * level;
    }
    return baseValue;
}

// Global processing buffer and utilities for performance
let globalProcessingBuffer = new Float32Array(1024 * 8);
let globalBufferResizeCount = 0;
function ensureBufferSize(numPoints) {
    if (globalProcessingBuffer.length < numPoints * 8) {
        const newSize = Math.max(numPoints * 8 * 2, 1024 * 8 * 2);
        globalProcessingBuffer = new Float32Array(newSize);
        globalBufferResizeCount++;
    }
}

export function applyEffects(frame, effects, context = {}) {
    const { progress = 0, time = performance.now(), effectStates, syncSettings = {}, fftLevels, direction = 'forward', style = 'loop' } = context;

    // Apply playback direction and style to progress for effects
    let effectiveProgress = progress;
    if (direction !== 'forward' || style !== 'loop') {
        effectiveProgress = calculateAnimPhase(progress, { style, direction }, 0, [0, 1]);
    }

    if (!effects || effects.length === 0) return frame;

    const sourcePoints = frame.points;
    const isSourceTyped = sourcePoints instanceof Float32Array;
    const numPointsCount = isSourceTyped ? (sourcePoints.length / 8) : sourcePoints.length;

    // Copy source to global processing buffer
    let currentNumPoints = numPointsCount;
    ensureBufferSize(numPointsCount);
    let activePoints = globalProcessingBuffer;
    if (isSourceTyped) {
        activePoints.set(sourcePoints);
    } else {
        // Fallback copy for non-typed arrays (objects)
        for (let i = 0; i < currentNumPoints; i++) {
            const p = sourcePoints[i];
            const offset = i * 8;
            activePoints[offset] = p.x ?? 0;
            activePoints[offset + 1] = p.y ?? 0;
            activePoints[offset + 2] = p.z ?? 0;
            activePoints[offset + 3] = p.r ?? 255;
            activePoints[offset + 4] = p.g ?? 255;
            activePoints[offset + 5] = p.b ?? 255;
            activePoints[offset + 6] = p.blanking ? 1 : 0;
            activePoints[offset + 7] = p.lastPoint ? 1 : 0;
        }
    }

    // Process each effect in sequence
    for (const effect of effects) {
        const params = effect.params;
        if (params?.enabled === false) continue;

        const instancePrefix = effect.instanceId ? `${effect.instanceId}.` : `${effect.id}.`;
        let needsResolution = false;
        for (const key in params) {
            if (syncSettings[instancePrefix + key]) {
                needsResolution = true;
                break;
            }
        }

        // Resolve synced parameters if needed
        let resolvedParams = params;
        if (needsResolution) {
            resolvedParams = { ...params };
            const linkXY = params.linkXY !== false;
            const pairs = linkedParamPairs[effect.id];
            for (const key in resolvedParams) {
                const paramKey = instancePrefix + key;
                if (syncSettings[paramKey]) {
                    resolvedParams[key] = resolveParam(key.replace(instancePrefix, ''), resolvedParams[key], syncSettings[paramKey], context);
                    if (linkXY && pairs && pairs[key] && !syncSettings[instancePrefix + pairs[key]] && resolvedParams[pairs[key]] !== undefined) {
                        resolvedParams[pairs[key]] = resolvedParams[key];
                    }
                }
            }
        }

        // Dispatch to appropriate handler
        switch (effect.id) {
            // --- Existing effects ---
            case 'rotate': applyRotate(activePoints, currentNumPoints, resolvedParams, effectiveProgress, time, effectStates, effect.instanceId); break;
            case 'scale': applyScale(activePoints, currentNumPoints, resolvedParams); break;
            case 'translate': applyTranslate(activePoints, currentNumPoints, resolvedParams); break;
            case 'color': applyColor(activePoints, currentNumPoints, resolvedParams, time); break;
            case 'wave': applyWave(activePoints, currentNumPoints, resolvedParams, time, effectStates, effect.instanceId); break;
            case 'blanking': applyBlanking(activePoints, currentNumPoints, resolvedParams); break;
            case 'strobe': applyStrobe(activePoints, currentNumPoints, resolvedParams, time); break;
            case 'mirror': 
                activePoints = applyMirror(activePoints, currentNumPoints, resolvedParams); 
                currentNumPoints = activePoints.length / 8;
                break;
            case 'warp': applyWarp(activePoints, currentNumPoints, resolvedParams); break;
            case 'move': applyMove(activePoints, currentNumPoints, resolvedParams, time); break;
            case 'delay': 
                if (effectStates && effect.instanceId) { 
                    activePoints = applyDelay(activePoints, currentNumPoints, resolvedParams, effectStates, effect.instanceId, context); 
                    currentNumPoints = activePoints.length / 8;
                } 
                break;
            case 'chase': 
                activePoints = applyChase(activePoints, currentNumPoints, resolvedParams, time, context); 
                currentNumPoints = activePoints.length / 8;
                break;

            // --- New point‑based effects ---
            case 'invert': applyInvert(activePoints, currentNumPoints, resolvedParams); break;
            case 'noise': applyNoise(activePoints, currentNumPoints, resolvedParams, time); break;
            case 'threshold': applyThreshold(activePoints, currentNumPoints, resolvedParams); break;
            case 'grow': applyGrow(activePoints, currentNumPoints, resolvedParams); break;

            // ... other existing effects continued ...
            default: /* no-op */ break;
        }

        // Runaway-frame guard: mirror (additive), delay and chase in frame mode
        // multiply point counts multiplicatively — a mirror×N + delay stack can
        // compound to >100k points and trip an out-of-range / giant-allocation
        // failure downstream. Capping each stage keeps every intermediate buffer
        // bounded; `reduceFramePoints` preserves blanks + lit-run structure, and
        // since no DAC budget ever exceeds this, visible output is unaffected.
        if (currentNumPoints > MAX_EFFECT_POINTS) {
            const hadDistributions = !!activePoints._channelDistributions;
            activePoints = reduceFramePoints(activePoints, currentNumPoints, MAX_EFFECT_POINTS);
            currentNumPoints = activePoints.length / 8;
            if (!hadDistributions || currentNumPoints > MAX_EFFECT_POINTS) {
                console.warn(`[effects] Frame exceeded ${MAX_EFFECT_POINTS} points; reduced to ${currentNumPoints} to prevent runaway allocation.`);
            }
        }
    }

    // Final result must be a NEW buffer because it's passed around, but we've reduced intermediate ones
    const finalPoints = new Float32Array(currentNumPoints * 8);
    finalPoints.set(activePoints.subarray(0, currentNumPoints * 8));
    if (activePoints._channelDistributions) {
        finalPoints._channelDistributions = activePoints._channelDistributions;
    }
    return { ...frame, points: finalPoints, isTypedArray: true, isClosed: frame.isClosed === true };
}
// Returns a continuous phase that integrates dt*speed instead of recomputing the
// whole `time*speed` product, which jumps when speed changes mid-playback.
// When effectStates (a Map) and a key are provided, the phase accumulates there;
// otherwise it falls back to absolute time (e.g. thumbnails).
function getContinuousPhase(effectStates, key, time, speed, dirMult = 1) {
    const canAccumulate = effectStates && key && typeof effectStates.get === 'function';
    if (!canAccumulate) {
        return (time * 0.001) * speed * dirMult;
    }
    let state = effectStates.get(key);
    if (!state) {
        state = { phase: 0, lastTime: time };
        effectStates.set(key, state);
    } else if (time >= state.lastTime) {
        state.phase += ((time - state.lastTime) * 0.001) * speed * dirMult;
        state.lastTime = time;
    }
    return state.phase;
}

function applyRotate(points, numPoints, params, progress, time, effectStates, instanceId) {
    const { angle, speed, direction } = params;
    const dirMult = direction === 'CCW' ? -1 : 1;
    const phaseOffset = getContinuousPhase(effectStates, instanceId ? `rotate:${instanceId}` : null, time, speed, dirMult);
    const currentAngle = (angle * Math.PI / 180) + phaseOffset;
    const sin = Math.sin(currentAngle);
    const cos = Math.cos(currentAngle);
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        const x = points[offset];
        const y = points[offset + 1];
        points[offset] = x * cos - y * sin;
        points[offset + 1] = x * sin + y * cos;
    }
}


function applyScale(points, numPoints, params) {
    const { scaleX, scaleY } = params;
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        points[offset] *= scaleX;
        points[offset + 1] *= scaleY;
    }
}

function applyTranslate(points, numPoints, params) {
    const { translateX, translateY } = params;
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        points[offset] += translateX;
        points[offset + 1] += translateY;
    }
}

const hexColorCache = new Map();
function hexToRgb(hex) {
    if (!hex) return { r: 255, g: 255, b: 255 };
    const cached = hexColorCache.get(hex);
    if (cached) return cached;

    let clean = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
    if (clean.length === 3) {
        clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    const num = parseInt(clean, 16);
    let parsed;
    if (Number.isNaN(num) || clean.length !== 6) {
        parsed = { r: 255, g: 255, b: 255 };
    } else {
        parsed = {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }
    if (hexColorCache.size > 256) hexColorCache.clear();
    hexColorCache.set(hex, parsed);
    return parsed;
}

function hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
        h = 0;
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, v };
}

const PRESET_PALETTES = {
    fire: [
        { r: 255, g: 0, b: 0 },
        { r: 255, g: 128, b: 0 },
        { r: 255, g: 255, b: 0 },
        { r: 255, g: 0, b: 0 }
    ],
    ice: [
        { r: 0, g: 0, b: 255 },
        { r: 0, g: 255, b: 255 },
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 255 }
    ],
    cyber: [
        { r: 255, g: 0, b: 255 },
        { r: 0, g: 255, b: 255 },
        { r: 0, g: 0, b: 255 },
        { r: 255, g: 0, b: 255 }
    ]
};

export function applyColor(points, numPoints, params, time = 0) {
    if (!points || numPoints <= 0) return;
    const {
        mode = 'solid', r = 255, g = 255, b = 255, color,
        hue, saturation, brightness,
        cycleSpeed = 0, rainbowSpread = 1.0, rainbowOffset = 0, rainbowPalette = 'rainbow',
        paletteColors = [], paletteSize = 4, paletteSpread = 1.0
    } = params;

    const cycleTime = time * 0.001 * cycleSpeed;
    const isTyped = points instanceof Float32Array || (typeof points.length === 'number' && typeof points[0] === 'number');

    if (mode === 'palette') {
        const activeCount = Math.min(paletteColors.length, paletteSize);
        const colors = activeCount > 0
            ? paletteColors.slice(0, activeCount).map(hexToRgb)
            : [{ r: 255, g: 255, b: 255 }];

        const colorCount = colors.length;
        const invNumPoints = paletteSpread / numPoints;
        const baseOffset = (cycleTime * 0.5) + (rainbowOffset / 360);

        for (let i = 0; i < numPoints; i++) {
            let normalizedPos = (i * invNumPoints + baseOffset) % 1.0;
            if (normalizedPos < 0) normalizedPos += 1.0;

            const scaledPos = normalizedPos * colorCount;
            const index = Math.floor(scaledPos);
            const factor = scaledPos - index;
            const c1 = colors[index % colorCount];
            const c2 = colors[(index + 1) % colorCount];

            const cr = Math.round(c1.r + (c2.r - c1.r) * factor);
            const cg = Math.round(c1.g + (c2.g - c1.g) * factor);
            const cb = Math.round(c1.b + (c2.b - c1.b) * factor);

            if (isTyped) {
                const offset = i * 8;
                points[offset + 3] = cr;
                points[offset + 4] = cg;
                points[offset + 5] = cb;
            } else if (points[i]) {
                points[i].r = cr;
                points[i].g = cg;
                points[i].b = cb;
            }
        }
    } else if (mode === 'rainbow') {
        const palette = rainbowPalette || 'rainbow';
        const invNumPoints = rainbowSpread / numPoints;
        const baseOffset = (cycleTime * 0.5) + (rainbowOffset / 360);

        if (palette === 'rainbow') {
            // Direct zero-allocation HSL rainbow (S=1, L=0.5)
            for (let i = 0; i < numPoints; i++) {
                let pos = (i * invNumPoints + baseOffset) % 1.0;
                if (pos < 0) pos += 1.0;

                const h6 = pos * 6;
                const sector = Math.floor(h6);
                const f = h6 - sector;
                const up = Math.round(f * 255);
                const down = Math.round((1 - f) * 255);

                let cr, cg, cb;
                switch (sector) {
                    case 0: cr = 255; cg = up; cb = 0; break;
                    case 1: cr = down; cg = 255; cb = 0; break;
                    case 2: cr = 0; cg = 255; cb = up; break;
                    case 3: cr = 0; cg = down; cb = 255; break;
                    case 4: cr = up; cg = 0; cb = 255; break;
                    default: cr = 255; cg = 0; cb = down; break;
                }

                if (isTyped) {
                    const offset = i * 8;
                    points[offset + 3] = cr;
                    points[offset + 4] = cg;
                    points[offset + 5] = cb;
                } else if (points[i]) {
                    points[i].r = cr;
                    points[i].g = cg;
                    points[i].b = cb;
                }
            }
        } else {
            // Preset palettes (fire, ice, cyber)
            const colors = PRESET_PALETTES[palette] || PRESET_PALETTES.fire;
            const maxIndex = colors.length - 1;

            for (let i = 0; i < numPoints; i++) {
                let pos = (i * invNumPoints + baseOffset) % 1.0;
                if (pos < 0) pos += 1.0;

                const scaledPos = pos * maxIndex;
                const index = Math.floor(scaledPos);
                const factor = scaledPos - index;
                const c1 = colors[index];
                const c2 = colors[index + 1] || c1;

                const cr = Math.round(c1.r + (c2.r - c1.r) * factor);
                const cg = Math.round(c1.g + (c2.g - c1.g) * factor);
                const cb = Math.round(c1.b + (c2.b - c1.b) * factor);

                if (isTyped) {
                    const offset = i * 8;
                    points[offset + 3] = cr;
                    points[offset + 4] = cg;
                    points[offset + 5] = cb;
                } else if (points[i]) {
                    points[i].r = cr;
                    points[i].g = cg;
                    points[i].b = cb;
                }
            }
        }
    } else {
        let fr = r, fg = g, fb = b;

        // HSV Parameters take priority for animation
        if (hue !== undefined && saturation !== undefined && brightness !== undefined) {
            [fr, fg, fb] = hsvToRgb(hue, saturation, brightness);
        } else if (color) {
            const c = hexToRgb(color);
            fr = c.r; fg = c.g; fb = c.b;
        }

        if (cycleSpeed !== 0) {
            let hueNorm = (cycleTime * (50 / 360)) % 1.0;
            if (hueNorm < 0) hueNorm += 1.0;
            const [cr, cg, cb] = hslToRgb(hueNorm, 1, 0.5);
            for (let i = 0; i < numPoints; i++) {
                if (isTyped) {
                    const offset = i * 8;
                    points[offset + 3] = cr;
                    points[offset + 4] = cg;
                    points[offset + 5] = cb;
                } else if (points[i]) {
                    points[i].r = cr;
                    points[i].g = cg;
                    points[i].b = cb;
                }
            }
        } else {
            for (let i = 0; i < numPoints; i++) {
                if (isTyped) {
                    const offset = i * 8;
                    points[offset + 3] = fr;
                    points[offset + 4] = fg;
                    points[offset + 5] = fb;
                } else if (points[i]) {
                    points[i].r = fr;
                    points[i].g = fg;
                    points[i].b = fb;
                }
            }
        }
    }
}

function getPaletteColor(paletteName, pos) {
    const colors = PRESET_PALETTES[paletteName] || PRESET_PALETTES.fire;
    const maxIndex = colors.length - 1;
    let p = pos % 1.0;
    if (p < 0) p += 1.0;
    const scaledPos = p * maxIndex;
    const index = Math.floor(scaledPos);
    const factor = scaledPos - index;
    const c1 = colors[index];
    const c2 = colors[index + 1] || c1;
    return [Math.round(c1.r + (c2.r - c1.r) * factor), Math.round(c1.g + (c2.g - c1.g) * factor), Math.round(c1.b + (c2.b - c1.b) * factor)];
}

function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

function hslToRgb(h, s, l) {
    if (s === 0) {
        const val = Math.round(l * 255);
        return [val, val, val];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
}

function applyWave(points, numPoints, params, time, effectStates, instanceId) {
    const { amplitude, frequency, speed, direction } = params;
    const timeShift = getContinuousPhase(effectStates, instanceId ? `wave:${instanceId}` : null, time, speed);
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        if (direction === 'x') {
            points[offset + 1] += amplitude * Math.sin(points[offset] * frequency + timeShift);
        } else if (direction === 'y') {
            points[offset] += amplitude * Math.sin(points[offset + 1] * frequency + timeShift);
        }
    }
}

export function applyBlanking(points, numPoints, params) {
    const blankingInterval = Number(params?.blankingInterval) || 0;
    const spacing = Number(params?.spacing) || 0;
    if (blankingInterval <= 0 || numPoints <= 0) return;

    const numSegments = Math.max(1, Math.round(blankingInterval));
    const effectiveSpacing = Math.max(0, spacing);
    const isTyped = points instanceof Float32Array || (typeof points.length === 'number' && typeof points[0] === 'number');

    for (let k = 0; k < numSegments; k++) {
        const startIdx = Math.round((k * numPoints) / numSegments);
        const endIdx = Math.round(((k + 1) * numPoints) / numSegments);
        const segLen = endIdx - startIdx;
        if (segLen <= 0) continue;

        // Blanking width in points. At spacing = 0, default to 1 point cut.
        // As spacing increases, the blanking width between the segments grows wider.
        const blankWidth = segLen === 1
            ? 1
            : Math.min(segLen - 1, Math.max(1, Math.round(effectiveSpacing + 1)));

        const blankStart = endIdx - blankWidth;
        for (let i = blankStart; i < endIdx; i++) {
            if (isTyped) {
                points[i * 8 + 6] = 1;
            } else if (points[i]) {
                points[i].blanking = true;
            }
        }
    }
}

function applyStrobe(points, numPoints, params, time) {
    const { strobeSpeed, strobeAmount } = params;
    const cyclePosition = (time % strobeSpeed) / strobeSpeed;
    if (cyclePosition < strobeAmount) {
        for (let i = 0; i < numPoints; i++) {
            points[i * 8 + 6] = 1;
        }
    }
}

function applyMirror(points, numPoints, params) {
    const { mode, additive = true, axisOffset = 0, planeRotation = 0 } = params;
    if (mode === 'none' || numPoints === 0) {
        // A subarray view silently drops the _channelDistributions property. When a
        // channel-mode delay/chase frame passes through a mirror that is left at its
        // default ('none') this would discard the per-channel map and every DAC would
        // receive the entire concatenated buffer. Keep the full copy for dist-bearing
        // frames so per-channel slicing survives downstream effects.
        const out = points.subarray(0, numPoints * 8);
        if (points._channelDistributions) {
            const copy = new Float32Array(out);
            copy._channelDistributions = points._channelDistributions;
            return copy;
        }
        return out;
    }

    const angleRad = planeRotation * Math.PI / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Helper to mirror coordinates in place on a temporary point object
    const tempCoord = { x: 0, y: 0 };
    const updateMirroredCoords = (x, y) => {
        let px = x, py = y;

        // 1. Rotate to axis-aligned
        if (angleRad !== 0) {
            const rx = x * cosA + y * sinA;
            const ry = -x * sinA + y * cosA;
            px = rx; py = ry;
        }

        // 2. Mirror
        if (mode === 'x-' || mode === 'x+') px = 2 * axisOffset - px;
        else if (mode === 'y-' || mode === 'y+') py = 2 * axisOffset - py;

        // 3. Rotate back
        if (angleRad !== 0) {
            const rx = px * cosA - py * sinA;
            const ry = px * sinA + py * cosA;
            px = rx; py = ry;
        }
        tempCoord.x = px; tempCoord.y = py;
    };

    const filterPoint = (x, y) => {
        if (additive) return true;
        let px = x, py = y;
        if (angleRad !== 0) {
            px = x * cosA + y * sinA;
            py = -x * sinA + y * cosA;
        }
        if (mode === 'x+') return px >= axisOffset;
        if (mode === 'x-') return px <= axisOffset;
        if (mode === 'y+') return py >= axisOffset;
        if (mode === 'y-') return py <= axisOffset;
        return true;
    };

    let newBuffer;
    const distributions = points._channelDistributions;

    if (distributions) {
        newBuffer = new Float32Array((numPoints * 2 + distributions.size * 2 + 50) * 8);
        const newDists = new Map();
        let currentOffset = 0;

        for (const [id, dist] of distributions) {
            const sliceNumPoints = dist.length / 8;
            const sliceStart = dist.start;
            const targetStart = currentOffset;
            let keptInSlice = 0;
            let lastWasIn = true;

            // 1. Original (filtered)
            for (let i = 0; i < sliceNumPoints; i++) {
                const off = sliceStart + i * 8;
                const isIn = filterPoint(points[off], points[off + 1]);
                if (isIn) {
                    if (!lastWasIn && keptInSlice > 0) {
                        newBuffer.set(points.subarray(off, off + 8), currentOffset);
                        newBuffer[currentOffset + 6] = 1;
                        newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
                        currentOffset += 8;
                        keptInSlice++;
                    }
                    newBuffer.set(points.subarray(off, off + 8), currentOffset);
                    currentOffset += 8;
                    keptInSlice++;
                }
                lastWasIn = isIn;
            }

            if (keptInSlice > 0) {
                // 2. Bridge source (copy of the last kept original point, blanked). It is
                // written AFTER the mirrored section so the buffer always ends blanked.
                // Otherwise the renderer's frame-level closing edge (last -> first) would
                // draw a lit connector line between the end of the mirrored copy and the
                // start of the original copy on closed frames (e.g. generator shapes).
                const bridgeSrcOff = currentOffset - 8;

                // 3. Mirrored (with shifted blanking)
                let lastWasInMirror = true;
                let mirrorKeptCount = 0;
                for (let i = sliceNumPoints - 1; i >= 0; i--) {
                    const off = sliceStart + i * 8;
                    const isIn = filterPoint(points[off], points[off + 1]);
                    if (isIn) {
                        // Bridge within mirrored part (if a point was filtered out)
                        if (!lastWasInMirror && mirrorKeptCount > 0) {
                            newBuffer.set(points.subarray(off, off + 8), currentOffset);
                            updateMirroredCoords(newBuffer[currentOffset], newBuffer[currentOffset + 1]);
                            newBuffer[currentOffset] = tempCoord.x; newBuffer[currentOffset + 1] = tempCoord.y;
                            newBuffer[currentOffset + 6] = 1;
                            newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
                            currentOffset += 8;
                        }

                        newBuffer.set(points.subarray(off, off + 8), currentOffset);
                        const dstOff = currentOffset;
                        updateMirroredCoords(newBuffer[dstOff], newBuffer[dstOff + 1]);
                        newBuffer[dstOff] = tempCoord.x; newBuffer[dstOff + 1] = tempCoord.y;

                        // METADATA SHIFT: Mirrored segment properties (color, blanking, intensity) 
                        // must come from the original's next point to preserve segment visibility in reverse.
                        if (i === sliceNumPoints - 1) {
                            newBuffer[dstOff + 6] = 1; // First mirrored point always blanked
                            newBuffer[dstOff + 3] = 0; newBuffer[dstOff + 4] = 0; newBuffer[dstOff + 5] = 0; // Zero color
                            newBuffer[dstOff + 7] = 0; // Zero intensity
                        } else {
                            // Copy R, G, B, Blanking, Intensity from the next point in the original sequence
                            newBuffer[dstOff + 3] = points[off + 8 + 3];
                            newBuffer[dstOff + 4] = points[off + 8 + 4];
                            newBuffer[dstOff + 5] = points[off + 8 + 5];
                            newBuffer[dstOff + 6] = points[off + 8 + 6];
                            newBuffer[dstOff + 7] = points[off + 8 + 7];
                        }

                        currentOffset += 8;
                        mirrorKeptCount++;
                    }
                    lastWasInMirror = isIn;
                }

                // 2b. Bridge (at the end of the slice, blanked)
                newBuffer.set(newBuffer.subarray(bridgeSrcOff, bridgeSrcOff + 8), currentOffset);
                newBuffer[currentOffset + 6] = 1;
                newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
                currentOffset += 8;

                newDists.set(id, { start: targetStart, length: (currentOffset - targetStart) });
            }
        }
        const finalBuffer = new Float32Array(currentOffset);
        finalBuffer.set(newBuffer.subarray(0, currentOffset));
        finalBuffer._channelDistributions = newDists;
        return finalBuffer;
    } else {
        newBuffer = new Float32Array((numPoints * 2 + 50) * 8);
        let currentOffset = 0;
        let keptPoints = 0;
        let lastWasIn = true;

        for (let i = 0; i < numPoints; i++) {
            const off = i * 8;
            const isIn = filterPoint(points[off], points[off + 1]);
            if (isIn) {
                if (!lastWasIn && keptPoints > 0) {
                    newBuffer.set(points.subarray(off, off + 8), currentOffset);
                    newBuffer[currentOffset + 6] = 1;
                    newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
                    currentOffset += 8;
                    keptPoints++;
                }
                newBuffer.set(points.subarray(off, off + 8), currentOffset);
                currentOffset += 8;
                keptPoints++;
            }
            lastWasIn = isIn;
        }

        if (keptPoints > 0) {
            // 2. Bridge source (copy of the last kept original point, blanked). It is
            // written AFTER the mirrored section so the buffer always ends blanked.
            // Otherwise the renderer's frame-level closing edge (last -> first) would
            // draw a lit connector line between the end of the mirrored copy and the
            // start of the original copy on closed frames (e.g. generator shapes).
            const bridgeSrcOff = currentOffset - 8;

            // 3. Mirrored (with shifted blanking)
            let lastWasInMirror = true;
            let mirrorKeptCount = 0;
            for (let i = numPoints - 1; i >= 0; i--) {
                const off = i * 8;
                const isIn = filterPoint(points[off], points[off + 1]);
                if (isIn) {
                    // Bridge within mirrored part (if a point was filtered out)
                    if (!lastWasInMirror && mirrorKeptCount > 0) {
                        newBuffer.set(points.subarray(off, off + 8), currentOffset);
                        updateMirroredCoords(newBuffer[currentOffset], newBuffer[currentOffset + 1]);
                        newBuffer[currentOffset] = tempCoord.x; newBuffer[currentOffset + 1] = tempCoord.y;
                        newBuffer[currentOffset + 6] = 1;
                        newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
                        currentOffset += 8;
                    }

                    newBuffer.set(points.subarray(off, off + 8), currentOffset);
                    const dstOff = currentOffset;
                    updateMirroredCoords(newBuffer[dstOff], newBuffer[dstOff + 1]);
                    newBuffer[dstOff] = tempCoord.x; newBuffer[dstOff + 1] = tempCoord.y;

                    // METADATA SHIFT: Mirrored segment properties (color, blanking, intensity) 
                    // must come from the original's next point to preserve segment visibility in reverse.
                    if (i === numPoints - 1) {
                        newBuffer[dstOff + 6] = 1; // First mirrored point always blanked
                        newBuffer[dstOff + 3] = 0; newBuffer[dstOff + 4] = 0; newBuffer[dstOff + 5] = 0; // Zero color
                        newBuffer[dstOff + 7] = 0; // Zero intensity
                    } else {
                        // Copy R, G, B, Blanking, Intensity from the next point in the original sequence
                        newBuffer[dstOff + 3] = points[off + 8 + 3];
                        newBuffer[dstOff + 4] = points[off + 8 + 4];
                        newBuffer[dstOff + 5] = points[off + 8 + 5];
                        newBuffer[dstOff + 6] = points[off + 8 + 6];
                        newBuffer[dstOff + 7] = points[off + 8 + 7];
                    }

                    currentOffset += 8;
                    mirrorKeptCount++;
                }
                lastWasInMirror = isIn;
            }

            // 2b. Bridge (at the end, blanked)
            newBuffer.set(newBuffer.subarray(bridgeSrcOff, bridgeSrcOff + 8), currentOffset);
            newBuffer[currentOffset + 6] = 1;
            newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
            currentOffset += 8;
        }
        return newBuffer.slice(0, currentOffset);
    }
}

// Gravitational warp: pulls (positive strength) or pushes (negative strength)
// points radially toward/away from a center position, attenuated by distance
// so the influence is strongest at the core and fades to zero at the radius.
// Time-independent – a pure spatial field, but every parameter is still
// animatable through the speed-sync methods.
function applyWarp(points, numPoints, params) {
    const { amount = 0.5, posX = 0, posY = 0, radius = 0.5, decay = 2 } = params;
    const rad = Math.max(0.00001, Math.abs(radius));
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        const x = points[offset];
        const y = points[offset + 1];
        const dx = x - posX;
        const dy = y - posY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 0.000001) continue;

        // Influence: 1.0 at the center, 0.0 at the radius edge
        const t = Math.min(1, dist / rad);
        const falloff = Math.pow(1 - t, decay);

        // Signed strength: positive attracts, negative repels
        const strength = amount * falloff;
        if (Math.abs(strength) <= 0.000001) continue;

        // Displacement capped at the point's distance so nothing crosses the center
        const mag = Math.min(dist, Math.abs(strength)) * (strength < 0 ? 1 : -1);
        points[offset] = x + (dx / dist) * mag;
        points[offset + 1] = y + (dy / dist) * mag;
    }
    return points;
}

function applyMove(points, numPoints, params, time) {
    const { speedX, speedY, sizeX = 1.0, sizeY = 1.0 } = params;
    const t = time * 0.001;
    const offsetX = t * speedX;
    const offsetY = t * speedY;
    // Bounce the shape within [-sizeX, sizeX] x [-sizeY, sizeY] using a reflex
    // triangle wave (cycle period 4*size, wrapping at twice the size).
    const fold = (v, size) => {
        if (!size || size <= 0) return v;
        const cycle = size * 4;
        let val = (v + size) % cycle;
        if (val < 0) val += cycle;
        if (val > size * 2) val = cycle - val;
        return val - size;
    };
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        const x = fold(points[offset] + offsetX, sizeX);
        const y = fold(points[offset + 1] + offsetY, sizeY);
        points[offset] = x; points[offset + 1] = y;
    }
}

// Utility: Simple 1D Perlin noise function
// ---------- New point‑based effect helpers ----------

function applyInvert(points, numPoints, params) {
    const { invertX, invertY, invertZ, invertColor } = params;
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        if (invertX) points[offset] = -points[offset];
        if (invertY) points[offset + 1] = -points[offset + 1];
        if (invertZ) points[offset + 2] = -points[offset + 2];
        if (invertColor) {
            const r = points[offset + 3];
            const g = points[offset + 4];
            const b = points[offset + 5];
            points[offset + 3] = 255 - r;
            points[offset + 4] = 255 - g;
            points[offset + 5] = 255 - b;
        }
    }
    return points;
}

function applyNoise(points, numPoints, params, time) {
    const { amplitude = 0.05, scale = 5, speed = 1, seed = 0 } = params;
    const t = time * 0.001 * speed;
    
    // Simple but stable pseudo-noise based on coordinates
    const getNoise = (nx, ny, nt) => {
        return Math.sin(nx * scale + nt) * Math.cos(ny * scale - nt * 0.7) * 
               Math.sin(nx * scale * 0.5 - ny * scale * 0.3 + nt * 1.1);
    };

    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        const x = points[offset];
        const y = points[offset + 1];
        
        // Decouple X and Y by using different phase shifts and offsets
        const noiseX = getNoise(x + seed, y, t);
        const noiseY = getNoise(x, y + seed + 10, t + 0.5);
        
        points[offset] += noiseX * amplitude;
        points[offset + 1] += noiseY * amplitude;
    }
    return points;
}

function applyThreshold(points, numPoints, params) {
    const { value = 0.5, mode = 'intensity', action = 'blank' } = params;
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        let threshold;
        switch (mode) {
            case 'red': threshold = points[offset + 3] / 255; break;
            case 'green': threshold = points[offset + 4] / 255; break;
            case 'blue': threshold = points[offset + 5] / 255; break;
            default: threshold = (points[offset + 3] + points[offset + 4] + points[offset + 5]) / (3 * 255);
        }
        if (threshold < value) {
            if (action === 'blank') {
                points[offset + 3] = 0;
                points[offset + 4] = 0;
                points[offset + 5] = 0;
                points[offset + 6] = 1;
            } else if (action === 'remove') {
                // Mark for removal by setting blanking flag; caller will filter
                points[offset + 6] = 1;
            }
        }
    }
    return points;
}

function applyGrow(points, numPoints, params) {
    const { factor = 1.5, centerX = 0, centerY = 0, ease = 0 } = params;
    const cX = centerX;
    const cY = centerY;
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        const x = points[offset];
        const y = points[offset + 1];
        const dx = x - cX;
        const dy = y - cY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const newDist = dist * factor;
        const ratio = dist > 0 ? newDist / dist : 0;
        points[offset] = cX + dx * ratio;
        points[offset + 1] = cY + dy * ratio;
    }
    return points;
}
// ---------- end of new helpers ----------


// Trim the delay/chase frame history, safely ignoring invalid sizes.
// Param values can arrive from MIDI/bindings outside the UI sliders' range, so
// guard against negative/NaN/oversized lengths (setting Array#length to those
// throws "Invalid array length").
function safeTrimHistory(history, maxHistory) {
    if (
        history &&
        Number.isFinite(maxHistory) &&
        maxHistory > 0 &&
        maxHistory <= 0xffffffff &&
        history.length > maxHistory
    ) {
        history.length = Math.floor(maxHistory);
    }
}

function resolveChannelStepOrder(customOrder, assignedDacs) {
    const hasDacs = Array.isArray(assignedDacs) && assignedDacs.length > 0;
    const hasOrder = Array.isArray(customOrder) && customOrder.length > 0;
    if (!hasDacs) return hasOrder ? customOrder.map(item => item.originalIndex !== undefined ? item.originalIndex : 0) : [0];
    if (!hasOrder) return assignedDacs.map((_, i) => i);

    const keyOf = (d) => (d && d.ip !== undefined) ? `${d.ip}:${d.channel !== undefined ? d.channel : ''}` : null;
    if (assignedDacs.every(d => keyOf(d) !== null)) {
        // Identity-match the saved order against the actual per-channel list so it
        // survives channel reordering/removal and the layer+clip list combination.
        return assignedDacs
            .map((d, i) => ({ d, i }))
            .sort((A, B) => {
                const ia = customOrder.findIndex(item => keyOf(item) === keyOf(A.d));
                const ib = customOrder.findIndex(item => keyOf(item) === keyOf(B.d));
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
            })
            .map(e => e.i);
    }

    // Legacy order entries without identity info: fall back to saved positions.
    return customOrder
        .map(item => item.originalIndex !== undefined ? item.originalIndex : 0)
        .filter(idx => idx >= 0 && idx < assignedDacs.length);
}

function applyDelay(points, numPoints, params, effectStates, instanceId, context) {
    const { mode = 'segment', delayAmount, decay, delayDirection, useCustomOrder, customOrder, playstyle = 'repeat', steps = 10 } = params;
    // points may be the shared processing buffer whose physical length exceeds
    // the logical frame size (numPoints * 8) — always size from numPoints.
    const currentFrameLen = numPoints * 8;
    if (!effectStates.has(instanceId)) effectStates.set(instanceId, []);
    const history = effectStates.get(instanceId);
    history.unshift(new Float32Array(points.subarray(0, currentFrameLen)));

    if (mode === 'segment') {
        // SEGMENT MODE THRESHOLD: Minimum 5 points required
        if (numPoints < 5) {
            return points;
        }

        const maxHistory = delayAmount * steps + 1;
        safeTrimHistory(history, maxHistory);
        const newPoints = new Float32Array(currentFrameLen);
        for (let i = 0; i < numPoints; i++) {
            let step = 0;
            const norm = i / numPoints;
            if (delayDirection === 'left_to_right') step = Math.floor(norm * steps);
            else if (delayDirection === 'right_to_left') step = Math.floor((1 - norm) * steps);
            else if (delayDirection === 'center_to_out') step = Math.floor(Math.abs(norm - 0.5) * 2 * steps);
            else if (delayDirection === 'out_to_center') step = Math.floor((1 - Math.abs(norm - 0.5) * 2) * steps);
            step = Math.min(steps - 1, Math.max(0, step));

            const idx = step * delayAmount;
            const echo = (idx < history.length) ? history[idx] : null;
            const factor = Math.pow(decay, step);
            const off = i * 8;

            if (echo && echo.length > 0) {
                let echoOff;
                if (echo.length === currentFrameLen) {
                    echoOff = off;
                } else {
                    const echoNumPoints = echo.length / 8;
                    let echoIdx = Math.floor(norm * echoNumPoints);
                    if (echoIdx >= echoNumPoints) echoIdx = echoNumPoints - 1;
                    echoOff = echoIdx * 8;
                }

                newPoints[off] = echo[echoOff];
                newPoints[off + 1] = echo[echoOff + 1];
                newPoints[off + 2] = echo[echoOff + 2];
                newPoints[off + 3] = echo[echoOff + 3] * factor;
                newPoints[off + 4] = echo[echoOff + 4] * factor;
                newPoints[off + 5] = echo[echoOff + 5] * factor;

                // CRITICAL: Preserve blanking from current frame (e.g. Mirror bridges) 
                // OR use the blanking from the echo frame.
                const inputBlanked = points[off + 6] > 0.5;
                newPoints[off + 6] = inputBlanked ? 1 : echo[echoOff + 6];
                if (newPoints[off + 6] > 0.5) {
                    newPoints[off + 3] = 0; newPoints[off + 4] = 0; newPoints[off + 5] = 0;
                }

                newPoints[off + 7] = echo[echoOff + 7];

                // 2-POINT BLANKING BRIDGE for step transitions
                if (i > 0) {
                    const prevNorm = (i - 1) / numPoints;
                    let prevStep = 0;
                    if (delayDirection === 'left_to_right') prevStep = Math.floor(prevNorm * steps);
                    else if (delayDirection === 'right_to_left') prevStep = Math.floor((1 - prevNorm) * steps);
                    else if (delayDirection === 'center_to_out') prevStep = Math.floor(Math.abs(prevNorm - 0.5) * 2 * steps);
                    else if (delayDirection === 'out_to_center') prevStep = Math.floor((1 - Math.abs(prevNorm - 0.5) * 2) * steps);
                    prevStep = Math.min(steps - 1, Math.max(0, prevStep));

                    if (prevStep !== step) {
                        // 1. Blank the destination point
                        newPoints[off + 6] = 1;
                        newPoints[off + 3] = 0; newPoints[off + 4] = 0; newPoints[off + 5] = 0;

                        // 2. Blank the source point (previous point)
                        const prevOff = (i - 1) * 8;
                        newPoints[prevOff + 6] = 1;
                        newPoints[prevOff + 3] = 0; newPoints[prevOff + 4] = 0; newPoints[prevOff + 5] = 0;
                    }
                }
            } else {
                newPoints.set(points.subarray(off, off + 8), off);
                newPoints[off + 3] = 0; newPoints[off + 4] = 0; newPoints[off + 5] = 0; newPoints[off + 6] = 1;
            }
        }
        if (points._channelDistributions) newPoints._channelDistributions = points._channelDistributions;
        return newPoints;
    } else if (mode === 'frame') {
        const numEchoes = steps;
        const maxHistory = delayAmount * numEchoes + 1;
        safeTrimHistory(history, maxHistory);

        const echoes = [];
        for (let k = 0; k < numEchoes; k++) {
            const index = k * delayAmount;
            const echoPoints = (index < history.length) ? history[index] : null;
            echoes.push({
                points: echoPoints,
                factor: Math.pow(decay, k)
            });
        }

        // Calculate precise total points needed by summing all echo sizes
        let totalPointsNeeded = 0;
        for (let k = 0; k < echoes.length; k++) {
            const src = echoes[k].points || points;
            totalPointsNeeded += (src === points ? numPoints : src.length / 8);
            if (k < echoes.length - 1) totalPointsNeeded += 1; // Bridge
        }

        // Frame-mode budget: each echo is a full copy of the frame, so steps
        // >~5 on a dense frame multiplies the point count past what any DAC
        // frame can hold. Instead of throwing echoes away (which would break
        // the step count the artist asked for), reduce each echo's fidelity
        // so the total concatenation fits the per-frame point budget. Only
        // active when over budget — normal under-budget frames pass through
        // untouched. The downstream DAC send decimates to ~1k regardless, so
        // this changes nothing visible on laser output; it just stops the
        // runaway counts that inflated stats to >300% (and crashed the
        // pipeline before MAX_EFFECT_POINTS existed).
        const frameBudget = Math.max(1, Math.floor((context && context.framePointBudget) || DEFAULT_FRAME_POINT_BUDGET));
        if (totalPointsNeeded > frameBudget && numEchoes > 1) {
            const perEchoBudget = Math.max(1, Math.floor((frameBudget - (numEchoes - 1)) / numEchoes));
            for (let k = 0; k < echoes.length; k++) {
                const echo = echoes[k];
                const src = echo.points || points;
                const srcNum = src === points ? numPoints : src.length / 8;
                if (srcNum > perEchoBudget) {
                    echo.points = reduceFramePoints(src, srcNum, perEchoBudget);
                }
            }
            totalPointsNeeded = 0;
            for (let k = 0; k < echoes.length; k++) {
                const src = echoes[k].points || points;
                totalPointsNeeded += (src === points ? numPoints : src.length / 8);
                if (k < echoes.length - 1) totalPointsNeeded += 1; // Bridge
            }
        }

        const newPoints = new Float32Array(totalPointsNeeded * 8);
        let currentOffset = 0;

        for (let k = 0; k < echoes.length; k++) {
            const echo = echoes[k];
            const src = echo.points || points;
            const factor = echo.factor;
            const srcNumPoints = src === points ? numPoints : src.length / 8;

            // Copy echo points
            for (let i = 0; i < srcNumPoints; i++) {
                const srcOff = i * 8;
                const dstOff = currentOffset + i * 8;
                newPoints[dstOff] = src[srcOff];
                newPoints[dstOff + 1] = src[srcOff + 1];
                newPoints[dstOff + 2] = src[srcOff + 2];
                newPoints[dstOff + 3] = src[srcOff + 3] * factor;
                newPoints[dstOff + 4] = src[srcOff + 4] * factor;
                newPoints[dstOff + 5] = src[srcOff + 5] * factor;

                // Force blanking on the first point of subsequent echoes to hide transition lines
                if (k > 0 && i === 0) {
                    newPoints[dstOff + 6] = 1;
                    newPoints[dstOff + 3] = 0; newPoints[dstOff + 4] = 0; newPoints[dstOff + 5] = 0;
                } else {
                    newPoints[dstOff + 6] = src[srcOff + 6];
                }

                newPoints[dstOff + 7] = src[srcOff + 7];
            }
            currentOffset += srcNumPoints * 8;

            // Add blanked bridge point after echo (except for the very last one)
            if (k < echoes.length - 1) {
                const lastSrcOff = (srcNumPoints - 1) * 8;
                const bridgeOff = currentOffset;
                newPoints[bridgeOff] = src[lastSrcOff];
                newPoints[bridgeOff + 1] = src[lastSrcOff + 1];
                newPoints[bridgeOff + 2] = src[lastSrcOff + 2];
                newPoints[bridgeOff + 3] = 0;
                newPoints[bridgeOff + 4] = 0;
                newPoints[bridgeOff + 5] = 0;
                newPoints[bridgeOff + 6] = 1;
                newPoints[bridgeOff + 7] = 0;
                currentOffset += 8;
            }
        }

        // NOTE: frame-mode delay concatenates per-echo copies, so input channel
        // distributions (if any) would describe echo 0 only — drop them instead of
        // copying stale offsets. Use channel mode for per-channel output.
        return newPoints;
    } else {
        const { assignedDacs } = context || {};
        let channelDelayMap = new Map();
        let maxStep = 0;
        const isCustom = useCustomOrder || params.delayMode === 'channel';
        if (isCustom) {
            const list = resolveChannelStepOrder(customOrder, assignedDacs);
            list.forEach((dacIdx, step) => { channelDelayMap.set(dacIdx, step); maxStep = Math.max(maxStep, step); });
        } else {
            const dacs = assignedDacs || [];
            const N = dacs.length || 1;
            for (let i = 0; i < N; i++) {
                let step = i;
                if (delayDirection === 'right_to_left') step = N - 1 - i;
                else if (delayDirection === 'center_to_out') step = Math.floor(Math.abs(i - (N - 1) / 2));
                else if (delayDirection === 'out_to_center') step = Math.min(i, N - 1 - i);
                channelDelayMap.set(i, step); maxStep = Math.max(maxStep, step);
            }
        }
        const numEchoes = maxStep + 1;
        const maxHistory = delayAmount * numEchoes + 1;
        safeTrimHistory(history, maxHistory);
        const echoes = [];
        for (let k = 0; k < numEchoes; k++) {
            const index = k * delayAmount;
            echoes.push({ points: (index < history.length) ? history[index] : null, factor: Math.pow(decay, k), index: k });
        }
        // Total point count isn't known until we walk each echo's effective length,
        // so allocate with a conservative cap and trim at the end (started at
        // totalPoints and grows by a 1-pt blanked bridge between echoes).
        const totalPoints = echoes.reduce((sum, e) => sum + (e.points ? e.points.length / 8 : numPoints), 0);
        const bufferLen = (totalPoints + Math.max(0, echoes.length - 1)) * 8;
        const newBuffer = new Float32Array(bufferLen);
        let offset = 0;
        const echoOffsets = new Array(echoes.length);
        for (let k = 0; k < echoes.length; k++) {
            const echo = echoes[k]; const ePoints = echo.points; const eNum = ePoints ? ePoints.length / 8 : numPoints;
            const factor = echo.factor;
            echoOffsets[k] = offset;
            for (let i = 0; i < eNum; i++) {
                const srcOff = i * 8; const dstOff = offset + i * 8;
                if (ePoints) {
                    newBuffer[dstOff] = ePoints[srcOff]; newBuffer[dstOff + 1] = ePoints[srcOff + 1]; newBuffer[dstOff + 2] = ePoints[srcOff + 2];
                    newBuffer[dstOff + 3] = ePoints[srcOff + 3] * factor; newBuffer[dstOff + 4] = ePoints[srcOff + 4] * factor; newBuffer[dstOff + 5] = ePoints[srcOff + 5] * factor;
                    newBuffer[dstOff + 6] = ePoints[srcOff + 6]; newBuffer[dstOff + 7] = ePoints[srcOff + 7];
                } else {
                    newBuffer[dstOff + 6] = 1;
                }
            }
            offset += eNum * 8;
            // Blanked bridge point between echoes so the concatenated frame (drawn as one
            // sequence in the preview) doesn't fire a visible line from the end of one echo
            // to the start of the next. Per-channel DAC slices never include the bridge.
            if (k < echoes.length - 1) {
                const lastOff = offset - 8;
                newBuffer[offset] = newBuffer[lastOff];
                newBuffer[offset + 1] = newBuffer[lastOff + 1];
                newBuffer[offset + 2] = newBuffer[lastOff + 2];
                newBuffer[offset + 3] = 0;
                newBuffer[offset + 4] = 0;
                newBuffer[offset + 5] = 0;
                newBuffer[offset + 6] = 1;
                newBuffer[offset + 7] = 0;
                offset += 8;
            }
        }
        const trimmed = new Float32Array(offset);
        trimmed.set(newBuffer.subarray(0, offset));
        const distributions = new Map();
        channelDelayMap.forEach((step, dacIndex) => {
            if (step < echoes.length) distributions.set(dacIndex, { start: echoOffsets[step], length: echoes[step].points ? echoes[step].points.length : currentFrameLen });
        });
        trimmed._channelDistributions = distributions;
        return trimmed;
    }
}

export function applyChase(points, numPoints, params, time, context = {}) {
    const { mode = 'segment', steps: paramSteps, decay, speed, overlap, emptyStep, direction, useCustomOrder, customOrder, playstyle = 'loop' } = params;
    const { progress = 0, clipDuration = 1, syncSettings = {} } = context;

    // Check if THIS specific parameter ('speed') is synced
    const instancePrefix = params.instanceId ? `${params.instanceId}.` : 'chase.';
    const isSpeedSynced = !!syncSettings[instancePrefix + 'speed'];
    const useSync = (progress !== undefined && clipDuration > 0) || isSpeedSynced;

    if (mode === 'segment') {
        const steps = paramSteps;
        // If synced, map 0..1 progress to 0..steps. If free, map 1s to 1 step.
        let t = (useSync ? (progress * steps) : (time * 0.001)) * speed;

        if (playstyle === 'bounce') {
            const range = steps;
            const cycle = t % (range * 2);
            t = cycle > range ? (range * 2) - cycle : cycle;
        } else if (playstyle === 'once') {
            t = Math.min(t, steps);
        } else {
            t = t % steps;
        }

        const newPoints = new Float32Array(numPoints * 8);
        for (let i = 0; i < numPoints; i++) {
            const norm = i / numPoints;
            let stepIndex = 0;
            if (direction === 'left_to_right') stepIndex = Math.min(steps - 1, Math.floor(norm * steps));
            else if (direction === 'right_to_left') stepIndex = Math.min(steps - 1, Math.floor((1 - norm) * steps));
            else if (direction === 'center_to_out') stepIndex = Math.min(steps - 1, Math.floor(Math.abs(norm - 0.5) * 2 * steps));
            else if (direction === 'out_to_center') stepIndex = Math.min(steps - 1, Math.floor((1 - Math.abs(norm - 0.5) * 2) * steps));

            let dist = Math.abs(t - stepIndex);
            if (dist > steps / 2) dist = steps - dist;
            let intensity = (dist < overlap) ? (1.0 - (dist / overlap)) : 0;
            if (decay > 0) intensity = Math.pow(intensity, 1 - decay);

            const off = i * 8;
            newPoints.set(points.subarray(off, off + 8), off);

            // Apply chase intensity
            newPoints[off + 3] *= intensity; newPoints[off + 4] *= intensity; newPoints[off + 5] *= intensity;

            // CRITICAL: Preserve blanking if the current point is already blanked (e.g. Mirror bridge)
            if (intensity < 0.05 || points[off + 6] > 0.5) {
                newPoints[off + 6] = 1;
                newPoints[off + 3] = 0; newPoints[off + 4] = 0; newPoints[off + 5] = 0;
            }

            // 2-POINT BLANKING BRIDGE for chase step transitions
            if (i > 0) {
                const prevNorm = (i - 1) / numPoints;
                let prevStepIndex = 0;
                if (direction === 'left_to_right') prevStepIndex = Math.min(steps - 1, Math.floor(prevNorm * steps));
                else if (direction === 'right_to_left') prevStepIndex = Math.min(steps - 1, Math.floor((1 - prevNorm) * steps));
                else if (direction === 'center_to_out') prevStepIndex = Math.min(steps - 1, Math.floor(Math.abs(prevNorm - 0.5) * 2 * steps));
                else if (direction === 'out_to_center') prevStepIndex = Math.min(steps - 1, Math.floor((1 - Math.abs(prevNorm - 0.5) * 2) * steps));

                if (prevStepIndex !== stepIndex) {
                    // 1. Blank the destination point
                    newPoints[off + 6] = 1;
                    newPoints[off + 3] = 0; newPoints[off + 4] = 0; newPoints[off + 5] = 0;

                    // 2. Blank the source point (previous point)
                    const prevOff = (i - 1) * 8;
                    newPoints[prevOff + 6] = 1;
                    newPoints[prevOff + 3] = 0; newPoints[prevOff + 4] = 0; newPoints[prevOff + 5] = 0;
                }
            }
        }
        if (points._channelDistributions) newPoints._channelDistributions = points._channelDistributions;
        return newPoints;
    } else {
        const { assignedDacs } = context || {};
        let channelStepMap = new Map();
        let numChannels = 0;
        if (useCustomOrder) {
            const list = resolveChannelStepOrder(customOrder, assignedDacs);
            list.forEach((dacIdx, stepIndex) => { channelStepMap.set(dacIdx, stepIndex); numChannels++; });
        } else {
            numChannels = (assignedDacs ? assignedDacs.length : 1) || 1;
            for (let i = 0; i < numChannels; i++) {
                let step = i;
                if (direction === 'right_to_left') step = numChannels - 1 - i;
                else if (direction === 'center_to_out') step = Math.floor(Math.abs(i - (numChannels - 1) / 2));
                else if (direction === 'out_to_center') step = Math.min(i, numChannels - 1 - i);
                channelStepMap.set(i, step);
            }
        }
        const cycleLength = numChannels;
        // If synced, map 0..1 progress to 0..numChannels. If free, map 1s to 1 step.
        let t = (useSync ? (progress * cycleLength) : (time * 0.001)) * speed;

        if (playstyle === 'bounce') {
            const range = cycleLength;
            const cycle = t % (range * 2);
            t = cycle > range ? (range * 2) - cycle : cycle;
        } else if (playstyle === 'once') {
            t = Math.min(t, cycleLength);
        } else {
            t = t % cycleLength;
        }

        // If the input is already a per-channel concatenation (e.g. it came from a
        // channel-mode Delay), chase should modulate each channel's OWN slice by its
        // step intensity and keep the buffer layout untouched. Duplicating the whole
        // concatenated frame per channel would make every channel re-render every
        // other channel's echoes ("double delay" / trailing shapes within a channel).
        const sourceDists = points._channelDistributions;
        if (sourceDists && sourceDists.size > 0) {
            // "Empty Step" (default) keeps a hard all-off plateau between beats;
            // switching it off widens the effective overlap to the full cycle so
            // the chase crossfades continuously with no channel ever blanked.
            const effOverlap = emptyStep === false ? Math.max(cycleLength, overlap) : overlap;
            const newBuffer = new Float32Array(points);
            for (const [dacIndex, dist] of sourceDists.entries()) {
                const stepIndex = channelStepMap.get(dacIndex) || 0;
                let chaseDist = Math.abs(t - stepIndex);
                if (chaseDist > cycleLength / 2) chaseDist = cycleLength - chaseDist;
                let intensity = (chaseDist < effOverlap) ? (1.0 - (chaseDist / effOverlap)) : 0;
                if (decay > 0) intensity = Math.pow(intensity, 1 - decay);
                for (let i = 0; i < dist.length; i += 8) {
                    const dstOff = dist.start + i;
                    newBuffer[dstOff + 3] *= intensity; newBuffer[dstOff + 4] *= intensity; newBuffer[dstOff + 5] *= intensity;
                    if (intensity < 0.05) newBuffer[dstOff + 6] = 1;
                }
            }
            newBuffer._channelDistributions = sourceDists;
            return newBuffer;
        }

        const totalPoints = numPoints * numChannels;
        const newBuffer = new Float32Array(totalPoints * 8);
        const distributions = new Map();
        // "Empty Step" (default) keeps a hard all-off plateau between beats;
        // switching it off widens the effective overlap to the full cycle so
        // the chase crossfades continuously with no channel ever blanked.
        const effOverlap = emptyStep === false ? Math.max(cycleLength, overlap) : overlap;
        let offset = 0;
        const dacIndices = Array.from(channelStepMap.keys());
        if (dacIndices.length === 0) dacIndices.push(0);
        for (const dacIndex of dacIndices) {
            const stepIndex = channelStepMap.get(dacIndex) || 0;
            let dist = Math.abs(t - stepIndex);
            if (dist > cycleLength / 2) dist = cycleLength - dist;
            let intensity = (dist < effOverlap) ? (1.0 - (dist / effOverlap)) : 0;
            if (decay > 0) intensity = Math.pow(intensity, 1 - decay);
            const startOffset = offset;
            for (let i = 0; i < numPoints; i++) {
                const srcOff = i * 8; const dstOff = offset + i * 8;
                newBuffer.set(points.subarray(srcOff, srcOff + 8), dstOff);
                newBuffer[dstOff + 3] *= intensity; newBuffer[dstOff + 4] *= intensity; newBuffer[dstOff + 5] *= intensity;
                if (intensity < 0.05) newBuffer[dstOff + 6] = 1;
            }
            distributions.set(dacIndex, { start: startOffset, length: numPoints * 8 });
            offset += numPoints * 8;
        }
        newBuffer._channelDistributions = distributions;
        return newBuffer;
    }
}

export function applyOutputProcessing(frame, settings, inPlace = false) {
    if (!settings || !frame || !frame.points) return frame;
    const { safetyZones, outputArea, transformationEnabled, transformationMode } = settings;
    let points = frame.points;
    const isTyped = frame.isTypedArray || points instanceof Float32Array;
    const numPoints = isTyped ? (points.length / 8) : points.length;

    // Optimization: If inPlace is true, we modify the points array directly to avoid allocation
    let newPoints = inPlace ? points : (isTyped ? new Float32Array(points) : points.map(p => ({ ...p })));

    for (let i = 0; i < numPoints; i++) {
        let x, y, r, g, b, blanking;
        if (isTyped) {
            x = newPoints[i * 8]; y = newPoints[i * 8 + 1];
            r = newPoints[i * 8 + 3]; g = newPoints[i * 8 + 4]; b = newPoints[i * 8 + 5];
            blanking = newPoints[i * 8 + 6];
        } else {
            x = newPoints[i].x; y = newPoints[i].y;
            r = newPoints[i].r; g = newPoints[i].g; b = newPoints[i].b;
            blanking = newPoints[i].blanking ? 1 : 0;
        }

        // 1. Apply Transformation (Scale/Crop)
        if (transformationEnabled && outputArea) {
            let u = (x + 1) / 2;
            let v = (1 - y) / 2; // Flip Y for V coordinate (0 at top)

            if (transformationMode === 'crop') {
                if (u < outputArea.x || u > outputArea.x + outputArea.w || v < outputArea.y || v > outputArea.y + outputArea.h) {
                    r = 0; g = 0; b = 0; blanking = 1;
                }
            } else if (transformationMode === 'scale') {
                u = outputArea.x + (u * outputArea.w);
                v = outputArea.y + (v * outputArea.h);
                x = u * 2 - 1;
                y = 1 - (v * 2);
            }
        }

        // 2. Apply Safety Zones (Check against TRANSFORMED coordinates)
        if (safetyZones && safetyZones.length > 0) {
            let u = (x + 1) / 2;
            let v = (1 - y) / 2;
            for (const zone of safetyZones) {
                if (u >= zone.x && u <= zone.x + zone.w && v >= zone.y && v <= zone.y + zone.h) {
                    r = 0; g = 0; b = 0; blanking = 1; break;
                }
            }
        }

        // 4. Clamping - Prevent hardware wraparound/halo effects
        x = Math.max(-1, Math.min(1, x));
        y = Math.max(-1, Math.min(1, y));

        if (isTyped) {
            newPoints[i * 8] = x; newPoints[i * 8 + 1] = y;
            newPoints[i * 8 + 3] = r; newPoints[i * 8 + 4] = g; newPoints[i * 8 + 5] = b;
            newPoints[i * 8 + 6] = blanking;
        } else {
            newPoints[i].x = x; newPoints[i].y = y;
            newPoints[i].r = r; newPoints[i].g = g; newPoints[i].b = b;
            newPoints[i].blanking = blanking > 0.5;
        }
    }
    return { ...frame, points: newPoints, isTypedArray: isTyped };
}
