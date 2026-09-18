// ILDA Writer Utility
// Implements saving frames to ILDA Format 5 (2D True Color).
//
// Accepts frames in any layout used across the app:
//   • object points:   [ { x, y, z?, r, g, b, blanking?, lastPoint? }, ... ]
//   • flat typed:      Float32Array with 8 floats per point: [x,y,z,r,g,b,blanking,lastPoint]
//   • nested arrays:   [ [x, y, z, r, g, b, blanking, lastPoint], ... ]
//
// Coordinates are normalized -1..1. Colors are raw 0..255 (values in (0,1] are
// treated as normalized and scaled to 0..255). Frames larger than the ILDA
// 16-bit point count (65535) are split into sequential ILDA frames so the count
// header field never silently wraps.

const ILDA_HEADER_SIZE = 32;
const ILDA_POINT_SIZE_FORMAT_5 = 8; // X(2) + Y(2) + Status(1) + B(1) + G(1) + R(1)

// Keep comfortably under the 16-bit max so the header count never wraps.
const MAX_POINTS_PER_FRAME = 65000;

function writeString(view, offset, string, length) {
    for (let i = 0; i < length; i++) {
        view.setUint8(offset + i, i < string.length ? string.charCodeAt(i) : 0);
    }
}

// Normalize any supported point layout into object points {x, y, r, g, b, blanking}.
function normalizeFramePoints(points) {
    const out = [];
    if (!points || points.length === 0) return out;

    if (points instanceof Float32Array) {
        const numPoints = points.length / 8;
        for (let i = 0; i < numPoints; i++) {
            const o = i * 8;
            out.push({
                x: points[o],
                y: points[o + 1],
                z: points[o + 2],
                r: points[o + 3],
                g: points[o + 4],
                b: points[o + 5],
                blanking: points[o + 6] > 0.5,
                lastPoint: points[o + 7] > 0.5,
            });
        }
    } else {
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (!p) continue;
            if (Array.isArray(p)) {
                out.push({
                    x: p[0], y: p[1], z: p[2],
                    r: p[3], g: p[4], b: p[5],
                    blanking: !!(p[6] > 0.5),
                    lastPoint: !!(p[7] > 0.5),
                });
            } else {
                out.push({
                    x: p.x, y: p.y, z: p.z,
                    r: p.r, g: p.g, b: p.b,
                    blanking: !!p.blanking,
                    lastPoint: !!p.lastPoint,
                });
            }
        }
    }
    return out;
}

// Convert a color channel (0..255 raw or 0..1 normalized) to 0..255.
function colorTo255(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n > 0 && n <= 1.0) return Math.round(n * 255);
    return Math.round(n);
}

function framesToIlda(frames) {
    // Build chunked frames, splitting any frame that is too dense to fit the
    // 16-bit point-count header field.
    const chunks = [];
    frames.forEach(frame => {
        const source = frame && frame.points ? normalizeFramePoints(frame.points) : [];
        const name = (frame && frame.frameName) || 'TrueLazr';
        const company = (frame && frame.companyName) || 'Gemini';
        const scannerHead = (frame && frame.scannerHead) || 0;

        if (source.length === 0) {
            chunks.push({ name, company, scannerHead, points: [] });
        } else {
            for (let start = 0; start < source.length; start += MAX_POINTS_PER_FRAME) {
                chunks.push({
                    name,
                    company,
                    scannerHead,
                    points: source.slice(start, start + MAX_POINTS_PER_FRAME),
                });
            }
        }
    });

    // Calculate total buffer size (chunks + 1 EOF header)
    let totalSize = ILDA_HEADER_SIZE;
    chunks.forEach(chunk => {
        totalSize += ILDA_HEADER_SIZE;
        totalSize += chunk.points.length * ILDA_POINT_SIZE_FORMAT_5;
    });

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    chunks.forEach((chunk, index) => {
        const points = chunk.points;
        const pointCount = points.length;

        // Write Header
        writeString(view, offset, 'ILDA', 4);
        view.setUint8(offset + 4, 0);
        view.setUint8(offset + 5, 0);
        view.setUint8(offset + 6, 0);
        view.setUint8(offset + 7, 5); // Format Code 5

        writeString(view, offset + 8, chunk.name, 8);
        writeString(view, offset + 16, chunk.company, 8);

        view.setUint16(offset + 24, pointCount, false); // Big Endian
        view.setUint16(offset + 26, index, false);
        view.setUint16(offset + 28, chunks.length, false);
        view.setUint8(offset + 30, chunk.scannerHead);
        view.setUint8(offset + 31, 0);

        offset += ILDA_HEADER_SIZE;

        // Write Points
        for (let i = 0; i < pointCount; i++) {
            const p = points[i];

            // Coordinates: Map -1.0..1.0 to -32768..32767
            const x = Math.max(-32768, Math.min(32767, Math.round((Number(p.x) || 0) * 32767)));
            const y = Math.max(-32768, Math.min(32767, Math.round((Number(p.y) || 0) * 32767)));

            view.setInt16(offset, x, false);
            view.setInt16(offset + 2, y, false);

            // Status Byte
            let status = 0;
            if (p.blanking) status |= 0x40; // Bit 6: Blanking
            if (i === pointCount - 1) status |= 0x80; // Bit 7: Last Point

            view.setUint8(offset + 4, status);

            // Colors (blanked points are written black)
            let r = 0, g = 0, b = 0;
            if (!p.blanking) {
                r = Math.max(0, Math.min(255, colorTo255(p.r)));
                g = Math.max(0, Math.min(255, colorTo255(p.g)));
                b = Math.max(0, Math.min(255, colorTo255(p.b)));
            }

            // Format 5: B (5), G (6), R (7)
            view.setUint8(offset + 5, b);
            view.setUint8(offset + 6, g);
            view.setUint8(offset + 7, r);

            offset += ILDA_POINT_SIZE_FORMAT_5;
        }
    });

    // Write EOF Header (Format 5 with 0 points)
    writeString(view, offset, 'ILDA', 4);
    view.setUint8(offset + 4, 0);
    view.setUint8(offset + 5, 0);
    view.setUint8(offset + 6, 0);
    view.setUint8(offset + 7, 5);
    writeString(view, offset + 8, 'EOF', 8);
    writeString(view, offset + 16, 'TrueLazr', 8);
    view.setUint16(offset + 24, 0, false);
    view.setUint16(offset + 26, 0, false);
    view.setUint16(offset + 28, 0, false);
    view.setUint8(offset + 30, 0);
    view.setUint8(offset + 31, 0);

    return buffer;
}

export { framesToIlda };