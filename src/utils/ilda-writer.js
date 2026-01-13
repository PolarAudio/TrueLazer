// ILDA Writer Utility
// Implements saving frames to ILDA Format 5 (2D True Color)

const ILDA_HEADER_SIZE = 32;
const ILDA_POINT_SIZE_FORMAT_5 = 8; // X(2) + Y(2) + Status(1) + B(1) + G(1) + R(1)

function writeString(view, offset, string, length) {
    for (let i = 0; i < length; i++) {
        view.setUint8(offset + i, i < string.length ? string.charCodeAt(i) : 0);
    }
}

function framesToIlda(frames) {
    // Calculate total buffer size
    let totalSize = 0;
    frames.forEach(frame => {
        totalSize += ILDA_HEADER_SIZE;
        const pointCount = frame.points ? frame.points.length : 0;
        totalSize += pointCount * ILDA_POINT_SIZE_FORMAT_5;
    });

    // Add EOF header (Format 5 header with 0 points) ? 
    // Usually explicit EOF is nice but not strictly required if file ends. 
    // Standard practice implies an empty frame or just end of file.
    // We'll leave it as is.

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    frames.forEach((frame, index) => {
        const points = frame.points || [];
        const pointCount = points.length;

        // Write Header
        writeString(view, offset, 'ILDA', 4);
        view.setUint8(offset + 4, 0); // Reserved
        view.setUint8(offset + 5, 0); // Reserved
        view.setUint8(offset + 6, 0); // Reserved
        view.setUint8(offset + 7, 5); // Format Code 5 (2D True Color)

        writeString(view, offset + 8, frame.frameName || 'TrueLazr', 8);
        writeString(view, offset + 16, frame.companyName || 'Gemini', 8);

        view.setUint16(offset + 24, pointCount, false); // Big Endian
        view.setUint16(offset + 26, index, false); // Frame Number
        view.setUint16(offset + 28, frames.length, false); // Total Frames
        view.setUint8(offset + 30, frame.scannerHead || 0);
        view.setUint8(offset + 31, 0); // Future

        offset += ILDA_HEADER_SIZE;

        // Write Points
        for (let i = 0; i < pointCount; i++) {
            const p = points[i];
            
            // Coordinates: Map -1.0..1.0 to -32768..32767
            let x = Math.max(-32768, Math.min(32767, Math.round((p.x || 0) * 32767)));
            let y = Math.max(-32768, Math.min(32767, Math.round((p.y || 0) * 32767)));
            
            view.setInt16(offset, x, false); // Big Endian
            view.setInt16(offset + 2, y, false);

            // Status Byte
            let status = 0;
            if (p.blanking) status |= 0x40; // Bit 6: Blanking
            if (i === pointCount - 1) status |= 0x80; // Bit 7: Last Point

            view.setUint8(offset + 4, status);

            // Colors
            // Assuming internal points use 0-255 range for r,g,b or 0-1.
            // Based on parser, they are 0-255 (if sourced from ILDA) or created manually.
            // If the app uses 0-1 internally for colors (WebGL style), we multiply.
            // Let's assume 0-1 if small, 0-255 if large.
            // Actually, `etherdream-communication` handles `r > 1.0` check.
            // Let's assume 0-1 for safety if strictly < 1.0, otherwise 0-255.
            
            let r = p.r || 0;
            let g = p.g || 0;
            let b = p.b || 0;

            if (r <= 1.0 && g <= 1.0 && b <= 1.0 && (r > 0 || g > 0 || b > 0 || p.blanking)) {
                 // It's likely normalized 0-1. If it's all 0, it's black.
                 // However, r=255 is > 1.0. 
                 // Safe heuristic: if any component > 1, assume 0-255.
                 // But wait, what if r=1 (very dark in 0-255)? 
                 // The app `etherdream-communication` treats `> 1.0` as 255-based.
                 // Let's do the same.
            }
            // Actually, we can just check if any are > 1.
            const isNormalized = (r <= 1 && g <= 1 && b <= 1);
            if (isNormalized) {
                r = Math.round(r * 255);
                g = Math.round(g * 255);
                b = Math.round(b * 255);
            } else {
                r = Math.round(r);
                g = Math.round(g);
                b = Math.round(b);
            }

            // Format 5: B, G, R order in memory? No, struct says B, G, R?
            // Wait, Format 5 point (ILDA spec):
            // X (2), Y (2), Status (1), Blue (1), Green (1), Red (1).
            view.setUint8(offset + 5, b);
            view.setUint8(offset + 6, g);
            view.setUint8(offset + 7, r);

            offset += ILDA_POINT_SIZE_FORMAT_5;
        }
    });

    return buffer;
}

export { framesToIlda };
