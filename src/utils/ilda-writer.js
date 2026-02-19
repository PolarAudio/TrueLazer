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
    // Calculate total buffer size (frames + 1 EOF header)
    let totalSize = ILDA_HEADER_SIZE; 
    frames.forEach(frame => {
        totalSize += ILDA_HEADER_SIZE;
        const pointCount = frame.points ? frame.points.length : 0;
        totalSize += pointCount * ILDA_POINT_SIZE_FORMAT_5;
    });

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    frames.forEach((frame, index) => {
        const points = frame.points || [];
        const pointCount = points.length;

        // Write Header
        writeString(view, offset, 'ILDA', 4);
        view.setUint8(offset + 4, 0); 
        view.setUint8(offset + 5, 0); 
        view.setUint8(offset + 6, 0); 
        view.setUint8(offset + 7, 5); // Format Code 5

        writeString(view, offset + 8, frame.frameName || 'TrueLazr', 8);
        writeString(view, offset + 16, frame.companyName || 'Gemini', 8);

        view.setUint16(offset + 24, pointCount, false); // Big Endian
        view.setUint16(offset + 26, index, false); 
        view.setUint16(offset + 28, frames.length, false); 
        view.setUint8(offset + 30, frame.scannerHead || 0);
        view.setUint8(offset + 31, 0); 

        offset += ILDA_HEADER_SIZE;

        // Write Points
        for (let i = 0; i < pointCount; i++) {
            const p = points[i];
            
            // Coordinates: Map -1.0..1.0 to -32768..32767
            let x = Math.max(-32768, Math.min(32767, Math.round((p.x || 0) * 32767)));
            let y = Math.max(-32768, Math.min(32767, Math.round((p.y || 0) * 32767)));
            
            view.setInt16(offset, x, false); 
            view.setInt16(offset + 2, y, false);

            // Status Byte
            let status = 0;
            if (p.blanking) status |= 0x40; // Bit 6: Blanking
            if (i === pointCount - 1) status |= 0x80; // Bit 7: Last Point

            view.setUint8(offset + 4, status);

            // Colors
            let r = 0, g = 0, b = 0;
            if (!p.blanking) {
                const pr = p.r ?? 0, pg = p.g ?? 0, pb = p.b ?? 0;
                const isNormalized = (pr <= 1.0 && pg <= 1.0 && pb <= 1.0) && (pr > 0 || pg > 0 || pb > 0);
                if (isNormalized) {
                    r = Math.round(pr * 255);
                    g = Math.round(pg * 255);
                    b = Math.round(pb * 255);
                } else {
                    r = Math.round(pr);
                    g = Math.round(pg);
                    b = Math.round(pb);
                }
            }

            // Format 5: B (5), G (6), R (7)
            view.setUint8(offset + 5, Math.max(0, Math.min(255, b)));
            view.setUint8(offset + 6, Math.max(0, Math.min(255, g)));
            view.setUint8(offset + 7, Math.max(0, Math.min(255, r)));

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
