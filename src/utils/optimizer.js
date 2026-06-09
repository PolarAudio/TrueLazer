const OPT_MAX_DIST = 0.02; // Reduced for better resolution (approx 1/50th of screen)
const OPT_PATH_DWELL = 2;   // Reduced for less "flicker/gaps" in optimized paths

export function optimizePoints(points, settings = {}) {
    if (!points) return new Float32Array(0);
    
    const isTyped = (points instanceof Float32Array) || points.isTypedArray;
    const numPoints = isTyped ? (points.length / 8) : points.length;

    if (numPoints === 0) return new Float32Array(0);

    const maxDist = Math.max(0.001, Number(settings.maxDist ?? OPT_MAX_DIST));
    const pathDwell = Math.max(0, Math.floor(Number(settings.pathDwell ?? OPT_PATH_DWELL)));

    // Passthrough if extremely large to prevent freezing
    if (numPoints > 4000) {
        if (points instanceof Float32Array) return points;
        const res = new Float32Array(numPoints * 8);
        for(let i=0; i<numPoints; i++) {
             const p = points[i];
             const off = i * 8;
             res[off] = p.x; res[off+1] = p.y; res[off+2] = p.z||0;
             res[off+3] = p.r; res[off+4] = p.g; res[off+5] = p.b;
             res[off+6] = p.blanking ? 1 : 0;
             res[off+7] = p.lastPoint ? 1 : 0;
        }
        return res;
    }

    const result = [];
    const push = (x, y, z, r, g, b, blk, last = 0) => {
        const finalR = blk ? 0 : r;
        const finalG = blk ? 0 : g;
        const finalB = blk ? 0 : b;
        result.push(x, y, z, finalR, finalG, finalB, blk ? 1 : 0, last);
    };

    const get = (i) => {
        if (isTyped) {
            const off = i * 8;
            return {
                x: points[off], y: points[off+1], z: points[off+2],
                r: points[off+3], g: points[off+4], b: points[off+5],
                blanking: points[off+6] > 0.5,
                lastPoint: points[off+7] > 0.5
            };
        } else {
            const p = points[i];
            return {
                x: p.x||0, y: p.y||0, z: p.z||0,
                r: p.r||0, g: p.g||0, b: p.b||0,
                blanking: !!p.blanking,
                lastPoint: !!p.lastPoint
            };
        }
    };

    // --- SEGMENT ANALYSIS ---
    // Break points into blanked and visible segments to detect loops independently
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

    // Identify which transitions should skip dwells
    const skipDwellAtIdx = new Uint8Array(numPoints + 1);
    let firstVisibleIdx = -1;
    let lastVisibleIdx = -1;

    segments.forEach(seg => {
        if (!seg.blanking) {
            const start = get(seg.startIdx);
            const end = get(seg.endIdx);
            const d = Math.sqrt(Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2));
            
            if (firstVisibleIdx === -1) firstVisibleIdx = seg.startIdx;
            lastVisibleIdx = seg.endIdx;

            // If this specific segment is a closed loop, skip dwells at its start and end
            if (d < 0.05) {
                skipDwellAtIdx[seg.startIdx] = 1;
                skipDwellAtIdx[seg.endIdx + 1] = 1;
            }
        }
    });

    // Also detect if the WHOLE FRAME loops back (last visible to first visible)
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
        // Always skip dwells at the very start/end boundaries of the visible content
        // to let the DAC looping handle it.
        skipDwellAtIdx[firstVisibleIdx] = 1;
        skipDwellAtIdx[lastVisibleIdx + 1] = 1;
    }

    // Use auto-detection or explicit setting
    const isClosed = settings.isClosed || frameIsClosed;

    // When closed, only process up to the last visible point to avoid trailing
    // blanking (common in ILDA files) breaking the loop closure.
    const processEndIdx = (isClosed && lastVisibleIdx !== -1) ? lastVisibleIdx + 1 : numPoints;

    let prevPoint = get(0);

    for (let i = 0; i < processEndIdx; i++) {
        const currPoint = get(i);

        // Blanking dwells
        if (prevPoint.blanking !== currPoint.blanking) {
            const skipDwell = skipDwellAtIdx[i] === 1;

            if (!skipDwell) {
                if (currPoint.blanking) {
                    for (let d = 0; d < pathDwell; d++) push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
                } else {
                    push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
                    for (let d = 0; d < pathDwell; d++) push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
                }
            }
        }

        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist > maxDist) {
            const steps = Math.floor(dist / maxDist);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                push(
                    prevPoint.x + dx * t, 
                    prevPoint.y + dy * t, 
                    prevPoint.z + (currPoint.z - prevPoint.z) * t, 
                    currPoint.blanking ? 0 : currPoint.r, 
                    currPoint.blanking ? 0 : currPoint.g, 
                    currPoint.blanking ? 0 : currPoint.b, 
                    currPoint.blanking
                );
            }
        }
        
        push(currPoint.x, currPoint.y, currPoint.z, currPoint.r, currPoint.g, currPoint.b, currPoint.blanking);
        prevPoint = currPoint;
    }

    // --- WRAP-AROUND HANDLING (End of Frame to Start of Next) ---
    const firstPoint = get(0);

    if (isClosed) {
        // CLOSE THE LOOP: Use the last visible point even when trailing blanking exists
        const closePoint = isClosed && lastVisibleIdx !== -1 ? get(lastVisibleIdx) : prevPoint;
        if (!firstPoint.blanking && !closePoint.blanking) {
            const wrapDx = firstPoint.x - closePoint.x;
            const wrapDy = firstPoint.y - closePoint.y;
            const wrapDist = Math.sqrt(wrapDx*wrapDx + wrapDy*wrapDy);
            if (wrapDist > maxDist) {
                const steps = Math.floor(wrapDist / maxDist);
                for (let s = 1; s < steps; s++) {
                    const t = s / steps;
                    push(
                        closePoint.x + wrapDx * t, 
                        closePoint.y + wrapDy * t, 
                        closePoint.z + (firstPoint.z - closePoint.z) * t, 
                        firstPoint.r, firstPoint.g, firstPoint.b, false
                    );
                }
            }
            // Push firstPoint to close the remaining gap — the interpolation
            // only reaches (steps-1)/steps of the closing edge, leaving
            // ~maxDist from p0. This single-point dwell at the same position
            // is invisible (laser at same spot) but prevents a visible gap.
            push(firstPoint.x, firstPoint.y, firstPoint.z, firstPoint.r, firstPoint.g, firstPoint.b, false);
        }
    } else {
        // OPEN SHAPE: Ensure we blank at the end of the frame before jumping back to start
        if (!prevPoint.blanking) {
            for (let d = 0; d < pathDwell; d++) push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
        }
        
        const openWrapDx = firstPoint.x - prevPoint.x;
        const openWrapDy = firstPoint.y - prevPoint.y;
        const openWrapDist = Math.sqrt(openWrapDx*openWrapDx + openWrapDy*openWrapDy);
        if (openWrapDist > 0.1) {
             push(firstPoint.x, firstPoint.y, firstPoint.z, 0, 0, 0, true);
             for (let d = 0; d < pathDwell; d++) push(firstPoint.x, firstPoint.y, firstPoint.z, 0, 0, 0, true);
        }
    }

    // Ensure the very last point in the result has the lastPoint flag set
    if (result.length >= 8) {
        result[result.length - 1] = 1;
    }

    const finalBuffer = new Float32Array(result);
    if (points._channelDistributions) {
        finalBuffer._channelDistributions = points._channelDistributions;
    }
    
    return finalBuffer;
}
