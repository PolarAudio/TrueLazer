// optimizer.js
// Budget-aware point optimizer (in-place rewrite).
//
// Given a source frame (object points or Float32Array of 8 values), produces an
// optimized Float32Array of 8 values per point (x,y,z,r,g,b,blanking,lastPoint)
// that applies laser-hardware optimizations:
//
//   - Blanking transitions  (start/end dwell)
//   - Anchor points         (start/end dwell)
//   - Lit point dwell       (start/end)
//   - Corner dwell + threshold
//   - Linear interpolation  (lit only) driven by interpolation distance
//   - Point-to-color timing shift (global + per-channel R/G/B)
//   - Minimum point padding
//   - Point budget enforcement (from target PPS/FPS)
//
// The optimizer reads its defaults from hardwarePresets.js so hardware presets
// and this module share one source of truth. Any setting passed in `settings`
// overrides the defaults/preset.

import {
    OPT_DEFAULTS,
    getOptimizerSettings,
    interpToDisplayUnits,
    cornerDegreesToCos,
} from './hardwarePresets.js';

const DEFAULTS = OPT_DEFAULTS;
const OPT_MAX_SOURCE_PASSTHROUGH = 4000; // above this, bypass geometry optimization

function numSetting(settings, key) {
    const v = settings && settings[key];
    if (v === undefined || v === null || Number.isNaN(Number(v))) return DEFAULTS[key];
    return Number(v);
}

function makeGet(points, isTyped) {
    return (i) => {
        if (isTyped) {
            const off = i * 8;
            return {
                x: points[off], y: points[off + 1], z: points[off + 2],
                r: points[off + 3], g: points[off + 4], b: points[off + 5],
                blanking: points[off + 6] > 0.5,
                lastPoint: points[off + 7] > 0.5,
            };
        }
        const p = points[i];
        return {
            x: p.x || 0, y: p.y || 0, z: p.z || 0,
            r: p.r || 0, g: p.g || 0, b: p.b || 0,
            blanking: !!p.blanking,
            lastPoint: !!p.lastPoint,
        };
    };
}

function passthrough(points, isTyped, numPoints) {
    if (isTyped) return points;
    const res = new Float32Array(numPoints * 8);
    for (let i = 0; i < numPoints; i++) {
        const p = points[i];
        const off = i * 8;
        res[off] = p.x; res[off + 1] = p.y; res[off + 2] = p.z || 0;
        res[off + 3] = p.r; res[off + 4] = p.g; res[off + 5] = p.b;
        res[off + 6] = p.blanking ? 1 : 0; res[off + 7] = p.lastPoint ? 1 : 0;
    }
    return res;
}

export function optimizePoints(points, settings = {}) {
    if (!points) return new Float32Array(0);

    const isTyped = (points instanceof Float32Array) || points.isTypedArray;
    const numPoints = isTyped ? (points.length / 8) : points.length;
    if (numPoints === 0) return new Float32Array(0);

    // Merge preset defaults + explicit overrides.
    const presetSettings = getOptimizerSettings(settings.preset, settings.overrides || null);
    const totalSettings = { ...presetSettings, ...settings };

    const maxDist = Math.max(0.0005, interpToDisplayUnits(numSetting(totalSettings, 'interpDistance')));
    const blankingStart = Math.max(0, Math.floor(numSetting(totalSettings, 'blankingStart')));
    const blankingEnd = Math.max(0, Math.floor(numSetting(totalSettings, 'blankingEnd')));
    const shift = Math.max(-20, Math.min(20, numSetting(totalSettings, 'shift')));
    const shiftR = Math.max(-20, Math.min(20, numSetting(totalSettings, 'shiftR')));
    const shiftG = Math.max(-20, Math.min(20, numSetting(totalSettings, 'shiftG')));
    const shiftB = Math.max(-20, Math.min(20, numSetting(totalSettings, 'shiftB')));
    const anchorStart = Math.max(0, Math.floor(numSetting(totalSettings, 'anchorStart')));
    const anchorEnd = Math.max(0, Math.floor(numSetting(totalSettings, 'anchorEnd')));
    const litDwellStart = Math.max(0, Math.floor(numSetting(totalSettings, 'litDwellStart')));
    const litDwellEnd = Math.max(0, Math.floor(numSetting(totalSettings, 'litDwellEnd')));
    const cornerDwell = Math.max(0, Math.floor(numSetting(totalSettings, 'cornerDwell')));
    const cornerCos = cornerDegreesToCos(numSetting(totalSettings, 'cornerThreshold'));
    const minPadding = Math.max(0, Math.floor(numSetting(totalSettings, 'minPadding')));

    let maxPoints;
    if (settings.maxPoints && settings.maxPoints > 0) {
        maxPoints = Math.max(10, Math.floor(settings.maxPoints));
    } else if (totalSettings.targetPps && totalSettings.targetFps) {
        maxPoints = Math.max(10, Math.floor(totalSettings.targetPps / totalSettings.targetFps));
    } else {
        maxPoints = Math.max(10, Math.floor(numSetting(totalSettings, 'pointBudget') || 1000));
    }
    // Enforce the minimum-point padding floor as a hard minimum budget.
    maxPoints = Math.max(maxPoints, minPadding);

    if (numPoints > OPT_MAX_SOURCE_PASSTHROUGH) {
        const res = passthrough(points, isTyped, numPoints);
        if (points._channelDistributions) res._channelDistributions = points._channelDistributions;
        return res;
    }

    const get = makeGet(points, isTyped);
    const result = [];

    // Color shift model: for an output point emitted from source span around
    // source index `srcIdx`, the RGB is read from source index
    //   colorIdx = clamp(srcIdx + shift + channelShift, 0, numPoints-1)
    // For interpolated points, srcIdx advances continuously; for dwell repeats
    // we keep the same source index. The source color lookup is bound to the
    // *geometric* source index that produced the current position.
    const colorIndexFor = (srcIdx, channelShift) =>
        Math.max(0, Math.min(numPoints - 1, Math.round(srcIdx + shift + channelShift)));

    // Emit a point with explicit geometry and color lookup keyed to srcIdx.
    // `srcIdx` may be fractional (interpolated) — colors use the rounded index.
    const push = (x, y, z, blk, srcIdx, last = 0) => {
        const r = blk ? 0 : get(colorIndexFor(srcIdx, shiftR)).r;
        const g = blk ? 0 : get(colorIndexFor(srcIdx, shiftG)).g;
        const b = blk ? 0 : get(colorIndexFor(srcIdx, shiftB)).b;
        result.push(x, y, z, r, g, b, blk ? 1 : 0, last);
    };

    // Convenience: emit using a specific integer source index (dwell/anchor).
    const pushAt = (x, y, z, blk, idx, last = 0) => push(x, y, z, blk, idx, last);

    // --- SEGMENT ANALYSIS ---
    const segments = [];
    let currentSegment = null;
    for (let i = 0; i < numPoints; i++) {
        const p = get(i);
        if (currentSegment === null || p.blanking !== currentSegment.blanking) {
            if (currentSegment) segments.push(currentSegment);
            currentSegment = { blanking: p.blanking, startIdx: i, endIdx: i };
        } else {
            currentSegment.endIdx = i;
        }
    }
    if (currentSegment) segments.push(currentSegment);

    let firstVisibleIdx = -1;
    let lastVisibleIdx = -1;
    const skipDwellAtIdx = new Uint8Array(numPoints + 1);
    segments.forEach(seg => {
        if (!seg.blanking) {
            if (firstVisibleIdx === -1) firstVisibleIdx = seg.startIdx;
            lastVisibleIdx = seg.endIdx;
            const start = get(seg.startIdx);
            const end = get(seg.endIdx);
            const d = Math.sqrt(Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2));
            if (d < 0.05) {
                skipDwellAtIdx[seg.startIdx] = 1;
                skipDwellAtIdx[seg.endIdx + 1] = 1;
            }
        }
    });

    let frameIsClosed = false;
    if (firstVisibleIdx !== -1 && lastVisibleIdx !== -1) {
        const fv = get(firstVisibleIdx);
        const lv = get(lastVisibleIdx);
        const d = Math.sqrt(Math.pow(fv.x - lv.x, 2) + Math.pow(fv.y - lv.y, 2));
        frameIsClosed = d < 0.05;
        if (frameIsClosed) {
            skipDwellAtIdx[firstVisibleIdx] = 1;
            skipDwellAtIdx[lastVisibleIdx + 1] = 1;
        }
        skipDwellAtIdx[firstVisibleIdx] = 1;
        skipDwellAtIdx[lastVisibleIdx + 1] = 1;
    }

    const isClosed = settings.isClosed || frameIsClosed;
    const processEndIdx = (isClosed && lastVisibleIdx !== -1) ? lastVisibleIdx + 1 : numPoints;

    // --- PHASE 1: Compute geometry and estimate budget ---
    let totalDist = 0;
    let totalInterpDesired = 0;
    let totalCornerCount = 0;
    let totalBlankTransitions = 0;

    for (let i = 1; i < processEndIdx; i++) {
        const prev = get(i - 1);
        const curr = get(i);
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        totalDist += dist;
        totalInterpDesired += Math.max(1, Math.floor(dist / maxDist));

        if (prev.blanking !== curr.blanking) {
            if (!(skipDwellAtIdx[i] === 1)) totalBlankTransitions++;
        }

        if (!prev.blanking && !curr.blanking && i > 1) {
            const prev2 = get(i - 2);
            const ax = prev.x - prev2.x;
            const ay = prev.y - prev2.y;
            const bx = curr.x - prev.x;
            const by = curr.y - prev.y;
            const aLen = Math.sqrt(ax * ax + ay * ay);
            const bLen = Math.sqrt(bx * bx + by * by);
            if (aLen > 0.0001 && bLen > 0.0001) {
                const dot = (ax * bx + ay * by) / (aLen * bLen);
                if (dot < cornerCos) totalCornerCount++;
            }
        }
    }

    let wrapDist = 0;
    if (isClosed && firstVisibleIdx !== -1 && lastVisibleIdx !== -1) {
        const fv = get(firstVisibleIdx);
        const lv = get(lastVisibleIdx);
        if (!fv.blanking && !lv.blanking) {
            const wdx = fv.x - lv.x;
            const wdy = fv.y - lv.y;
            wrapDist = Math.sqrt(wdx * wdx + wdy * wdy);
            totalInterpDesired += Math.max(1, Math.floor(wrapDist / maxDist));
            totalDist += wrapDist;
        }
    }

    // --- PHASE 2: Compute effective parameters within budget ---
    const blankTransitionCost = totalBlankTransitions * (blankingStart + blankingEnd);
    const fixedCost = processEndIdx + blankTransitionCost;
    const dwellCost = totalCornerCount * cornerDwell;
    const totalDesired = fixedCost + dwellCost + totalInterpDesired;

    let effectiveMaxDist = maxDist;
    let effectiveCornerDwell = cornerDwell;

    if (totalDesired > maxPoints) {
        const availableForInterp = Math.max(1, maxPoints - fixedCost - dwellCost);
        const ratio = availableForInterp / totalInterpDesired;
        effectiveMaxDist = totalDist / Math.max(1, (totalInterpDesired * ratio));

        const testOutput = fixedCost + totalCornerCount * effectiveCornerDwell +
            Math.floor(totalDist / effectiveMaxDist);
        if (testOutput > maxPoints && totalCornerCount > 0) {
            effectiveCornerDwell = Math.max(0,
                Math.floor((maxPoints - fixedCost - Math.floor(totalDist / effectiveMaxDist)) / totalCornerCount));
        }
    }

    // --- PHASE 3: Generate output points ---
    let prevPoint = get(0);

    // Start anchor dwell at the first lit point.
    if (!prevPoint.blanking && anchorStart > 0) {
        for (let d = 0; d < anchorStart; d++) pushAt(prevPoint.x, prevPoint.y, prevPoint.z, false, 0);
    }
    if (!prevPoint.blanking && litDwellStart > 0) {
        for (let d = 0; d < litDwellStart; d++) pushAt(prevPoint.x, prevPoint.y, prevPoint.z, false, 0);
    }
    pushAt(prevPoint.x, prevPoint.y, prevPoint.z, prevPoint.blanking, 0);

    for (let i = 1; i < processEndIdx; i++) {
        const currPoint = get(i);

        // Blanking transition dwell (start/end counts)
        if (prevPoint.blanking !== currPoint.blanking) {
            if (!(skipDwellAtIdx[i] === 1)) {
                if (currPoint.blanking) {
                    // lit -> blank : blankingStart dwell at prev (blanked)
                    for (let d = 0; d < blankingStart; d++) push(prevPoint.x, prevPoint.y, prevPoint.z, true, i - 1);
                } else {
                    // blank -> lit : blankingEnd dwell at curr (blanked) then lit dwell at curr
                    for (let d = 0; d < blankingEnd; d++) push(currPoint.x, currPoint.y, currPoint.z, true, i);
                    if (litDwellStart > 0) {
                        for (let d = 0; d < litDwellStart; d++) pushAt(currPoint.x, currPoint.y, currPoint.z, false, i);
                    }
                }
            }
        } else if (!prevPoint.blanking && !currPoint.blanking && effectiveCornerDwell > 0 && i > 1) {
            // Corner dwell at prevPoint (end of previous edge)
            const prev2 = get(i - 2);
            const ax = prevPoint.x - prev2.x;
            const ay = prevPoint.y - prev2.y;
            const bx = currPoint.x - prevPoint.x;
            const by = currPoint.y - prevPoint.y;
            const aLen = Math.sqrt(ax * ax + ay * ay);
            const bLen = Math.sqrt(bx * bx + by * by);
            if (aLen > 0.0001 && bLen > 0.0001) {
                const dot = (ax * bx + ay * by) / (aLen * bLen);
                if (dot < cornerCos) {
                    for (let d = 0; d < effectiveCornerDwell; d++) pushAt(prevPoint.x, prevPoint.y, prevPoint.z, false, i - 1);
                }
            }
        }

        // Interpolation between prevPoint and currPoint.
        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > effectiveMaxDist) {
            const steps = Math.floor(dist / effectiveMaxDist);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                const srcIdx = (i - 1) + t; // fractional source index for color shift
                push(
                    prevPoint.x + dx * t,
                    prevPoint.y + dy * t,
                    prevPoint.z + (currPoint.z - prevPoint.z) * t,
                    currPoint.blanking,
                    srcIdx,
                );
            }
        }

        // End lit dwell on the last lit point of the path.
        const isPathEnd = (i === processEndIdx - 1);
        if (!currPoint.blanking && isPathEnd && litDwellEnd > 0) {
            for (let d = 0; d < litDwellEnd; d++) pushAt(currPoint.x, currPoint.y, currPoint.z, false, i);
        }
        if (!currPoint.blanking && isPathEnd && anchorEnd > 0) {
            for (let d = 0; d < anchorEnd; d++) pushAt(currPoint.x, currPoint.y, currPoint.z, false, i);
        }

        pushAt(currPoint.x, currPoint.y, currPoint.z, currPoint.blanking, i);
        prevPoint = currPoint;
    }

    // --- WRAP-AROUND ---
    const firstPoint = get(0);
    if (isClosed && firstVisibleIdx !== -1 && lastVisibleIdx !== -1) {
        const closePoint = get(lastVisibleIdx);
        if (!firstPoint.blanking && !closePoint.blanking) {
            const wdx = firstPoint.x - closePoint.x;
            const wdy = firstPoint.y - closePoint.y;
            const wd = Math.sqrt(wdx * wdx + wdy * wdy);
            if (wd > effectiveMaxDist) {
                const steps = Math.floor(wd / effectiveMaxDist);
                for (let s = 1; s < steps; s++) {
                    const t = s / steps;
                    const srcIdx = (lastVisibleIdx - 1) + t;
                    push(
                        closePoint.x + wdx * t,
                        closePoint.y + wdy * t,
                        closePoint.z + (firstPoint.z - closePoint.z) * t,
                        false,
                        srcIdx,
                    );
                }
            }
            if (anchorEnd > 0) {
                for (let d = 0; d < anchorEnd; d++) pushAt(firstPoint.x, firstPoint.y, firstPoint.z, false, firstVisibleIdx);
            }
            pushAt(firstPoint.x, firstPoint.y, firstPoint.z, false, firstVisibleIdx);
        }
    } else {
        if (!prevPoint.blanking) {
            if (anchorEnd > 0) {
                for (let d = 0; d < anchorEnd; d++) pushAt(prevPoint.x, prevPoint.y, prevPoint.z, true, processEndIdx - 1);
            }
            for (let d = 0; d < blankingEnd; d++) push(prevPoint.x, prevPoint.y, prevPoint.z, true, processEndIdx - 1);
        }
        const owdx = firstPoint.x - prevPoint.x;
        const owdy = firstPoint.y - prevPoint.y;
        const owd = Math.sqrt(owdx * owdx + owdy * owdy);
        if (owd > 0.02) {
            // Interpolate a BLANKED return sweep back to the first point. Without
            // interpolation the galvos would be commanded to fly across the full
            // path in one point step, which physical DACs show as a visible
            // "jump to center" / "line from first to last" artifact. Step the sweep
            // every <=0.04 display units (never fewer than 2 points) so each DAC's
            // retrace is gradual and dark.
            const stepSize = Math.min(effectiveMaxDist || 0.02, 0.04);
            const steps = Math.max(2, Math.floor(owd / stepSize));
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                push(
                    prevPoint.x + owdx * t,
                    prevPoint.y + owdy * t,
                    prevPoint.z + (firstPoint.z - prevPoint.z) * t,
                    true,
                    Math.max(0, processEndIdx - 1),
                );
            }
        }
        if (anchorEnd > 0) {
            for (let d = 0; d < anchorEnd; d++) pushAt(firstPoint.x, firstPoint.y, firstPoint.z, true, 0);
        }
        for (let d = 0; d < blankingEnd; d++) pushAt(firstPoint.x, firstPoint.y, firstPoint.z, true, 0);
    }

    if (result.length >= 8) {
        result[result.length - 1] = 1;
    }

    // --- PHASE 4: Point padding to the minimum floor ---
    let finalArray;
    const currentCount = result.length / 8;
    if (minPadding > 0 && currentCount < minPadding) {
        const padded = new Float32Array(minPadding * 8);
        for (let i = 0; i < currentCount; i++) {
            const srcOff = i * 8;
            const dstOff = i * 8;
            for (let k = 0; k < 8; k++) padded[dstOff + k] = result[srcOff + k];
        }
        const lastOff = (currentCount - 1) * 8;
        const lx = result[lastOff] || 0;
        const ly = result[lastOff + 1] || 0;
        const lz = result[lastOff + 2] || 0;
        for (let i = currentCount; i < minPadding; i++) {
            const off = i * 8;
            padded[off] = lx; padded[off + 1] = ly; padded[off + 2] = lz;
            padded[off + 3] = 0; padded[off + 4] = 0; padded[off + 5] = 0;
            padded[off + 6] = 1; padded[off + 7] = 0;
        }
        padded[(minPadding - 1) * 8 + 7] = 1;
        finalArray = padded;
    } else {
        finalArray = new Float32Array(result);
    }

    // --- PHASE 5: Safety trim (should rarely trigger now) ---
    if (finalArray.length / 8 > maxPoints) {
        const n = finalArray.length / 8;
        const step = n / maxPoints;
        const trimmed = [];
        let prevBlank = null;
        for (let i = 0; i < n; i++) {
            const off = i * 8;
            const blank = finalArray[off + 6] === 1;
            const blankChanged = prevBlank !== null && blank !== prevBlank;
            const keep = (i === 0) || (i === n - 1) ||
                blankChanged ||
                (Math.floor(i / step) !== Math.floor((i - 1) / step));
            if (keep) {
                for (let k = 0; k < 8; k++) trimmed.push(finalArray[off + k]);
            }
            prevBlank = blank;
        }
        const trimmedBuffer = new Float32Array(trimmed);
        if (points._channelDistributions) trimmedBuffer._channelDistributions = points._channelDistributions;
        return trimmedBuffer;
    }

    if (points._channelDistributions) finalArray._channelDistributions = points._channelDistributions;
    return finalArray;
}
