const OPT_MAX_DIST = 0.08; 
const OPT_CORNER_DWELL = 3; 
const OPT_PATH_DWELL = 4;   

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

    let prevPoint = get(0);

    for (let i = 0; i < numPoints; i++) {
        const currPoint = get(i);

        // Blanking dwells
        if (prevPoint.blanking !== currPoint.blanking) {
            if (currPoint.blanking) {
                // Moving into blanking
                for (let d = 0; d < OPT_PATH_DWELL; d++) push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
            } else {
                // Moving into visible
                push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
                for (let d = 0; d < OPT_PATH_DWELL; d++) push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
            }
        }

        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        // Interpolate long jumps
        if (dist > OPT_MAX_DIST) {
            const steps = Math.floor(dist / OPT_MAX_DIST);
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

    // REMOVED intelligent loop closure to prevent unwanted lines on opened shapes.
    // Laser data should represent exactly what's in the buffer.

    const finalBuffer = new Float32Array(result);
    if (points._channelDistributions) {
        finalBuffer._channelDistributions = points._channelDistributions;
    }
    
    return finalBuffer;
}
