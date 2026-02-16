/**
 * Calculates cubic bezier control points to create a smooth curve through a set of anchor points.
 * Uses a modified Catmull-Rom to Cubic Bezier conversion.
 * 
 * @param {Array} anchors - Array of {x, y} anchor points.
 * @param {boolean} closed - Whether the path is a closed loop.
 * @param {number} tension - Tension parameter (0.5 is standard Catmull-Rom).
 * @returns {Array} Array of {x, y} points in the format: P0, CP1, CP2, P1, CP3, CP4, P2...
 */
export function calculateSmoothHandles(anchors, closed = false, tension = 0.5) {
    if (!anchors || anchors.length < 2) return anchors || [];

    const result = [];
    const n = anchors.length;

    // Helper to get anchor with wrap-around
    const getAnchor = (i) => {
        if (closed) {
            return anchors[(i + n) % n];
        }
        return anchors[Math.max(0, Math.min(n - 1, i))];
    };

    const segmentsCount = closed ? n : n - 1;

    for (let i = 0; i < segmentsCount; i++) {
        const p0 = getAnchor(i - 1);
        const p1 = getAnchor(i);
        const p2 = getAnchor(i + 1);
        const p3 = getAnchor(i + 2);

        // Calculate control points
        // Tension 0.5 means CPs are 1/6 of the way between neighbors
        // To get a straight line for 2 points, we adjust logic if neighbors are same as endpoints
        
        let cp1, cp2;

        if (!closed && n === 2) {
            // Special case for only 2 points: perfectly straight
            cp1 = {
                x: p1.x + (p2.x - p1.x) / 3,
                y: p1.y + (p2.y - p1.y) / 3
            };
            cp2 = {
                x: p2.x - (p2.x - p1.x) / 3,
                y: p2.y - (p2.y - p1.y) / 3
            };
        } else {
            cp1 = {
                x: p1.x + (p2.x - p0.x) * tension / 3,
                y: p1.y + (p2.y - p0.y) * tension / 3
            };
            cp2 = {
                x: p2.x - (p3.x - p1.x) * tension / 3,
                y: p2.y - (p3.y - p1.y) * tension / 3
            };
        }

        if (i === 0) {
            result.push({ ...p1 });
        }
        
        result.push(cp1);
        result.push(cp2);
        result.push({ ...p2 });
    }

    return result;
}
