
const OPT_MAX_DIST = 0.08; 
const OPT_CORNER_DWELL = 3; 
const OPT_PATH_DWELL = 4;   
const JUMP_THRESHOLD = 1.5; // Increased from 0.5 to avoid blanking large shapes like rectangles

export function optimizePoints(points) {
    if (!points) return new Float32Array(0);
    
    const isTyped = (points instanceof Float32Array) || points.isTypedArray;
    const numPoints = isTyped ? (points.length / 8) : points.length;

    // Passthrough if extremely large to prevent freezing
    if (numPoints > 4000) {
        if (points instanceof Float32Array) return points;
        const res = new Float32Array(numPoints * 8);
        for(let i=0; i<numPoints; i++) {
             const p = points[i];
             res[i*8] = p.x; res[i*8+1] = p.y; res[i*8+2] = p.z||0;
             res[i*8+3] = p.r; res[i*8+4] = p.g; res[i*8+5] = p.b;
             res[i*8+6] = p.blanking ? 1 : 0;
             res[i*8+7] = p.lastPoint ? 1 : 0;
        }
        return res;
    }

    const result = [];
    
    const push = (x, y, z, r, g, b, blk) => {
        // Ensure color is 0 if blanked
        const finalR = blk ? 0 : r;
        const finalG = blk ? 0 : g;
        const finalB = blk ? 0 : b;
        result.push(x, y, z, finalR, finalG, finalB, blk ? 1 : 0, 0);
    };

    const get = (i) => {
        if (isTyped) {
            const off = i * 8;
            return {
                x: points[off], y: points[off+1], z: points[off+2],
                r: points[off+3], g: points[off+4], b: points[off+5],
                blanking: points[off+6] > 0.5
            };
        } else {
            const p = points[i];
            return {
                x: p.x||0, y: p.y||0, z: p.z||0,
                r: p.r||0, g: p.g||0, b: p.b||0,
                blanking: !!p.blanking
            };
        }
    };

    if (numPoints === 0) return new Float32Array(0);

    // Find first lit point for intelligent loop closure
    let firstLitPoint = null;
    for (let i = 0; i < numPoints; i++) {
        const p = get(i);
        if (!p.blanking) {
            firstLitPoint = p;
            break;
        }
    }

    let prevPoint = get(0);

    for (let i = 0; i < numPoints; i++) {
        const currPoint = get(i);

        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
// ... (rest of loop is same)
        push(currPoint.x, currPoint.y, currPoint.z, currPoint.r, currPoint.g, currPoint.b, currPoint.blanking);
        
        prevPoint = currPoint;
    }

    // Loop Closing Optimization: Transition from Last Point back to First Point
    const firstPoint = get(0);
    const targetClosePoint = firstLitPoint || firstPoint;
    const dx = targetClosePoint.x - prevPoint.x;
    const dy = targetClosePoint.y - prevPoint.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    // Intelligent loop closure: 
    // 1. If points are very close and not blanked, just interpolate without jumping
    // 2. Otherwise, perform a standard blanked jump
    const isSeamless = dist < 0.1 && !targetClosePoint.blanking && !prevPoint.blanking;
    const isJumpClose = !isSeamless && (firstPoint.blanking || prevPoint.blanking || dist > JUMP_THRESHOLD);

    if (isSeamless) {
        // Just push the target point again to close the path
        if (dist > OPT_MAX_DIST) {
            const steps = Math.floor(dist / OPT_MAX_DIST);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                push(prevPoint.x + dx * t, prevPoint.y + dy * t, prevPoint.z + (targetClosePoint.z - prevPoint.z) * t, 
                     prevPoint.r + (targetClosePoint.r - prevPoint.r) * t, 
                     prevPoint.g + (targetClosePoint.g - prevPoint.g) * t, 
                     prevPoint.b + (targetClosePoint.b - prevPoint.b) * t, false);
            }
        }
        push(targetClosePoint.x, targetClosePoint.y, targetClosePoint.z, targetClosePoint.r, targetClosePoint.g, targetClosePoint.b, false);
    } else if (isJumpClose) {
        // Only perform blanked jump if the distance is significant
        if (dist > 0.01) {
            push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
            push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);

            const dxStart = firstPoint.x - prevPoint.x;
            const dyStart = firstPoint.y - prevPoint.y;
            const distStart = Math.sqrt(dxStart*dxStart + dyStart*dyStart);

            if (distStart > OPT_MAX_DIST) {
                const steps = Math.floor(distStart / OPT_MAX_DIST);
                for (let s = 1; s < steps; s++) {
                    const t = s / steps;
                    push(prevPoint.x + dxStart * t, prevPoint.y + dyStart * t, prevPoint.z + (firstPoint.z - prevPoint.z) * t, 0, 0, 0, true);
                }
            }
            for (let d = 0; d < OPT_PATH_DWELL; d++) {
                push(firstPoint.x, firstPoint.y, firstPoint.z, 0, 0, 0, true);
            }
        }
    }

    const finalBuffer = new Float32Array(result);
    // CRITICAL: Preserve channel distribution metadata for 'Channel Mode' effects
    if (points._channelDistributions) {
        finalBuffer._channelDistributions = points._channelDistributions;
    }
    
    return finalBuffer;
}
