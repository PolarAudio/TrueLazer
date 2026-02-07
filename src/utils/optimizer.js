
const OPT_MAX_DIST = 0.08; 
const OPT_CORNER_DWELL = 3; 
const OPT_PATH_DWELL = 4;   
const JUMP_THRESHOLD = 0.5; // High threshold, rely on blanking for separate objects

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
        result.push(x, y, z, r, g, b, blk ? 1 : 0, 0);
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

    let prevPoint = get(0);

    for (let i = 0; i < numPoints; i++) {
        const currPoint = get(i);

        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        // A segment is a "jump" (blanked) if:
        // 1. Destination is blanked
        // 2. OR source was blanked (moving from a blanked state)
        // 3. OR the distance is so large it's clearly a jump between separate objects
        const isJump = currPoint.blanking || prevPoint.blanking || dist > JUMP_THRESHOLD;

        // 1. Immediate blanking for jumps
        if (isJump && !prevPoint.blanking) {
            push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
            push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
        }

        // 2. Distance Interpolation (Path to current point)
        if (dist > OPT_MAX_DIST) {
            const steps = Math.floor(dist / OPT_MAX_DIST);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                const ix = prevPoint.x + dx * t;
                const iy = prevPoint.y + dy * t;
                const iz = prevPoint.z + (currPoint.z - prevPoint.z) * t;
                
                const ir = isJump ? 0 : currPoint.r;
                const ig = isJump ? 0 : currPoint.g;
                const ib = isJump ? 0 : currPoint.b;
                const iblk = isJump || currPoint.blanking;

                push(ix, iy, iz, ir, ig, ib, iblk);
            }
        }

        // 3. Blanking State Change Dwell
        if (prevPoint.blanking !== currPoint.blanking) {
            // Efficiency: use fewer dwells if distance is tiny or if we are in high-freq mode
            const dwellCount = dist < 0.01 ? 1 : OPT_PATH_DWELL;
            for (let d = 0; d < dwellCount; d++) {
                push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
            }
        }

        // 4. Push actual point
        push(currPoint.x, currPoint.y, currPoint.z, currPoint.r, currPoint.g, currPoint.b, currPoint.blanking);
        
        prevPoint = currPoint;
    }

    // Loop Closing Optimization: Transition from Last Point back to First Point
    const firstPoint = get(0);
    const dx = firstPoint.x - prevPoint.x;
    const dy = firstPoint.y - prevPoint.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    // Intelligent loop closure: 
    // 1. If points are very close and not blanked, just interpolate without jumping
    // 2. Otherwise, perform a standard blanked jump
    const isSeamless = dist < 0.01 && !firstPoint.blanking && !prevPoint.blanking;
    const isJumpClose = !isSeamless && (firstPoint.blanking || prevPoint.blanking || dist > JUMP_THRESHOLD);

    if (isSeamless) {
        // Just push the first point again to close the path
        push(firstPoint.x, firstPoint.y, firstPoint.z, firstPoint.r, firstPoint.g, firstPoint.b, false);
    } else if (isJumpClose) {
        // Only perform blanked jump if the distance is significant
        if (dist > 0.01) {
            push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
            push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);

            if (dist > OPT_MAX_DIST) {
                const steps = Math.floor(dist / OPT_MAX_DIST);
                for (let s = 1; s < steps; s++) {
                    const t = s / steps;
                    push(prevPoint.x + dx * t, prevPoint.y + dy * t, prevPoint.z + (firstPoint.z - prevPoint.z) * t, 0, 0, 0, true);
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
