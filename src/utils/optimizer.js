
const OPT_MAX_DIST = 0.08; 
const OPT_CORNER_DWELL = 3; 
const OPT_PATH_DWELL = 3;   

export function optimizePoints(points) {
    if (!points) return new Float32Array(0);
    
    const isTyped = (points instanceof Float32Array) || points.isTypedArray;
    const numPoints = isTyped ? (points.length / 8) : points.length;

    // Passthrough if large
    if (numPoints > 2000) {
        if (points instanceof Float32Array) return points;
        // Convert to typed
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
    // Note: The driver logic starts loop at 0.
    // Driver: firstPoint = get(0); prev = first; loop i=0..N.
    // i=0: curr=get(0). prev==curr. dist=0. pushes curr.
    // So it pushes the first point.

    for (let i = 0; i < numPoints; i++) {
        const currPoint = get(i);

        // Blanking State Change Dwell
        if (prevPoint.blanking !== currPoint.blanking) {
            if (currPoint.blanking) {
                // Going BLANK: Hold previous position blanked
                for (let d = 0; d < OPT_PATH_DWELL; d++) {
                    push(prevPoint.x, prevPoint.y, prevPoint.z, 0, 0, 0, true);
                }
            } else {
                // Going LIT: Hold current position blanked before lighting up
                // push({ ...currPoint, r: 0, g: 0, b: 0, blanking: true });
                push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
                for (let d = 0; d < OPT_PATH_DWELL; d++) {
                     push(currPoint.x, currPoint.y, currPoint.z, 0, 0, 0, true);
                }
            }
        }

        // Distance Interpolation
        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist > OPT_MAX_DIST) {
            const steps = Math.floor(dist / OPT_MAX_DIST);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                // Interpolate pos
                const ix = prevPoint.x + dx * t;
                const iy = prevPoint.y + dy * t;
                const iz = prevPoint.z + (currPoint.z - prevPoint.z) * t;
                
                // Color logic from driver:
                // r: currPoint.blanking ? 0 : currPoint.r
                // If destination is blank, interpolation is blank/black.
                // If destination is lit, interpolation is lit (color of destination).
                const ir = currPoint.blanking ? 0 : currPoint.r;
                const ig = currPoint.blanking ? 0 : currPoint.g;
                const ib = currPoint.blanking ? 0 : currPoint.b;
                const iblk = currPoint.blanking;

                push(ix, iy, iz, ir, ig, ib, iblk);
            }
        }

        // Push current
        push(currPoint.x, currPoint.y, currPoint.z, currPoint.r, currPoint.g, currPoint.b, currPoint.blanking);
        
        prevPoint = currPoint;
    }

    return new Float32Array(result);
}
