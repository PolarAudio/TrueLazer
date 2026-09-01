const OPT_MAX_DIST = 0.02;
const OPT_PATH_DWELL = 2;
const OPT_CORNER_DWELL = 2;
const OPT_CORNER_COS = 0.866; // cos(30°) — angle change > 30° = corner
const OPT_MAX_POINTS = 1000;

export function optimizePoints(points, settings = {}) {
    if (!points) return new Float32Array(0);

    const isTyped = (points instanceof Float32Array) || points.isTypedArray;
    const numPoints = isTyped ? (points.length / 8) : points.length;
    if (numPoints === 0) return new Float32Array(0);

    const maxDist = Math.max(0.001, Number(settings.maxDist ?? OPT_MAX_DIST));
    const pathDwell = Math.max(0, Math.floor(Number(settings.pathDwell ?? OPT_PATH_DWELL)));
    const maxPoints = Math.max(10, Math.floor(Number(settings.maxPoints ?? OPT_MAX_POINTS)));
    const cornerDwell = Math.max(0, Math.floor(Number(settings.cornerDwell ?? OPT_CORNER_DWELL)));
    const cornerCos = Math.min(0.999, Math.max(-0.999, Number(settings.cornerAngle ?? OPT_CORNER_COS)));

    if (numPoints > 4000) {
        if (points instanceof Float32Array) return points;
        const res = new Float32Array(numPoints * 8);
        for (let i = 0; i < numPoints; i++) {
            const p = points[i];
            const off = i * 8;
            res[off] = p.x; res[off + 1] = p.y; res[off + 2] = p.z || 0;
            res[off + 3] = p.r; res[off + 4] = p.g; res[off + 5] = p.b;
            res[off + 6] = p.blanking ? 1 : 0;
            res[off + 7] = p.lastPoint ? 1 : 0;
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
                x: points[off], y: points[off + 1], z: points[off + 2],
                r: points[off + 3], g: points[off + 4], b: points[off + 5],
                blanking: points[off + 6] > 0.5,
                lastPoint: points[off + 7] > 0.5
            };
        } else {
            const p = points[i];
            return {
                x: p.x || 0, y: p.y || 0, z: p.z || 0,
                r: p.r || 0, g: p.g || 0, b: p.b || 0,
                blanking: !!p.blanking,
                lastPoint: !!p.lastPoint
            };
        }
    };

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
            if (!(skipDwellAtIdx[i] === 1)) {
                totalBlankTransitions++;
            }
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

    // Wrap-around edge for closed shapes
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
    const fixedCost = processEndIdx + totalBlankTransitions * pathDwell;
    const dwellCost = totalCornerCount * cornerDwell;
    const totalDesired = fixedCost + dwellCost + totalInterpDesired;

    let effectiveMaxDist = maxDist;
    let effectiveCornerDwell = cornerDwell;

    if (totalDesired > maxPoints) {
        const availableForInterp = Math.max(1, maxPoints - fixedCost - dwellCost);
        const ratio = availableForInterp / totalInterpDesired;
        effectiveMaxDist = totalDist / Math.max(1, (totalInterpDesired * ratio));

        // If still over budget, reduce corner dwells
        const testOutput = fixedCost + totalCornerCount * effectiveCornerDwell +
            Math.floor(totalDist / effectiveMaxDist);
        if (testOutput > maxPoints && totalCornerCount > 0) {
            effectiveCornerDwell = Math.max(0,
                Math.floor((maxPoints - fixedCost - Math.floor(totalDist / effectiveMaxDist)) / totalCornerCount));
        }
    }

    // If under budget, keep effectiveMaxDist = maxDist for best quality

    // --- PHASE 3: Generate output points ---
    let prevPoint = get(0);
    push(prevPoint.x, prevPoint.y, prevPoint.z,
        prevPoint.r, prevPoint.g, prevPoint.b, prevPoint.blanking);

    for (let i = 1; i < processEndIdx; i++) {
        const currPoint = get(i);

        // Blanking transition dwell
        if (prevPoint.blanking !== currPoint.blanking) {
            if (!(skipDwellAtIdx[i] === 1)) {
                if (currPoint.blanking) {
                    for (let d = 0; d < pathDwell; d++) {
                        push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
                    }
                } else {
                    push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
                    for (let d = 0; d < pathDwell; d++) {
                        push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
                    }
                }
            }
        } else if (!prevPoint.blanking && !currPoint.blanking && effectiveCornerDwell > 0 && i > 1) {
            // Corner dwell at prevPoint (the end of the previous edge)
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
                    for (let d = 0; d < effectiveCornerDwell; d++) {
                        push(prevPoint.x, prevPoint.y, prevPoint.z,
                            prevPoint.r, prevPoint.g, prevPoint.b, false);
                    }
                }
            }
        }

        // Interpolation between prevPoint and currPoint
        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > effectiveMaxDist) {
            const steps = Math.floor(dist / effectiveMaxDist);
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

        push(currPoint.x, currPoint.y, currPoint.z,
            currPoint.r, currPoint.g, currPoint.b, currPoint.blanking);
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
                    push(
                        closePoint.x + wdx * t,
                        closePoint.y + wdy * t,
                        closePoint.z + (firstPoint.z - closePoint.z) * t,
                        firstPoint.r, firstPoint.g, firstPoint.b, false
                    );
                }
            }
            push(firstPoint.x, firstPoint.y, firstPoint.z,
                firstPoint.r, firstPoint.g, firstPoint.b, false);
        }
    } else {
        if (!prevPoint.blanking) {
            for (let d = 0; d < pathDwell; d++) {
                push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
            }
        }
        const owdx = firstPoint.x - prevPoint.x;
        const owdy = firstPoint.y - prevPoint.y;
        const owd = Math.sqrt(owdx * owdx + owdy * owdy);
        if (owd > 0.1) {
            push(firstPoint.x, firstPoint.y, firstPoint.z, 0, 0, 0, true);
            for (let d = 0; d < pathDwell; d++) {
                push(firstPoint.x, firstPoint.y, firstPoint.z, 0, 0, 0, true);
            }
        }
    }

    if (result.length >= 8) {
        result[result.length - 1] = 1;
    }

    // --- PHASE 4: Safety trim (should rarely trigger now) ---
    if (result.length / 8 > maxPoints) {
        const n = result.length / 8;
        const step = n / maxPoints;
        const trimmed = [];
        let prevBlank = null;
        for (let i = 0; i < n; i++) {
            const off = i * 8;
            const blank = result[off + 6] === 1;
            const blankChanged = prevBlank !== null && blank !== prevBlank;
            const keep = (i === 0) || (i === n - 1) ||
                blankChanged ||
                (Math.floor(i / step) !== Math.floor((i - 1) / step));
            if (keep) {
                for (let k = 0; k < 8; k++) trimmed.push(result[off + k]);
            }
            prevBlank = blank;
        }
        const finalBuffer = new Float32Array(trimmed);
        if (points._channelDistributions) {
            finalBuffer._channelDistributions = points._channelDistributions;
        }
        return finalBuffer;
    }

    const finalBuffer = new Float32Array(result);
    if (points._channelDistributions) {
        finalBuffer._channelDistributions = points._channelDistributions;
    }
    return finalBuffer;
}
