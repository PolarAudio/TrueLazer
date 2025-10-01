const defaultPalette = [
  { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 255, g: 128, b: 0 }, { r: 128, g: 255, b: 0 },
  { r: 0, g: 255, b: 128 }, { r: 0, g: 128, b: 255 }, { r: 128, g: 0, b: 255 }, { r: 255, g: 0, b: 128 },
  { r: 255, g: 255, b: 255 }, { r: 128, g: 128, b: 128 }, { r: 255, g: 128, b: 128 }, { r: 128, g: 255, b: 128 },
  { r: 128, g: 128, b: 255 }, { r: 255, g: 255, b: 128 }, { r: 128, g: 255, b: 255 }, { r: 255, g: 128, b: 255 },
];

export const parseIldaFile = (arrayBuffer) => {
  const frames = [];
  const view = new DataView(arrayBuffer);
  let offset = 0;

  while (offset < arrayBuffer.byteLength) {
    // Check if we have enough bytes for a header (32 bytes)
    if (offset + 32 > arrayBuffer.byteLength) {
      console.warn("Parser: Not enough bytes for ILDA header");
      break;
    }

    // Check for ILDA signature "ILDA"
    const signature = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

    if (signature !== 'ILDA') {
      console.warn(`Parser: Invalid ILDA signature at offset ${offset}, got: ${signature}`);
      offset++;
      continue;
    }

    // Verify format byte
    const formatCode = view.getUint8(offset + 7);
    if (formatCode > 5) {
      console.warn(`Parser: Unknown format code: ${formatCode} at offset ${offset}`);
      offset += 32; // Skip this header and try next
      continue;
    }

    const pointCount = view.getUint16(offset + 24, false); // Big-endian
    const frameNumber = view.getUint16(offset + 26, false);
    const totalFrames = view.getUint16(offset + 28, false);
    const projectorNumber = view.getUint8(offset + 30); // Usually 0

    if (pointCount === 0) {
      console.log("Parser: Empty frame, skipping");
      offset += 32;
      continue;
    }

    // Calculate record size based on format
    let recordSize;
    switch (formatCode) {
      case 0: recordSize = 8; break;  // 3D Indexed Color
      case 1: recordSize = 6; break;  // 2D Indexed Color  
      case 2: recordSize = 8; break;  // Color Palette (skip)
      case 4: recordSize = 10; break; // 3D True Color
      case 5: recordSize = 8; break;  // 2D True Color
      default:
        console.warn(`Parser: Unsupported format ${formatCode}, skipping`);
        offset += 32;
        continue;
    }

    // Check if we have enough data for all points
    const pointsDataSize = pointCount * recordSize;
    if (offset + 32 + pointsDataSize > arrayBuffer.byteLength) {
      console.warn(`Parser: Not enough data for ${pointCount} points, needed: ${pointsDataSize} bytes`);
      break;
    }

    offset += 32; // Move past header

    const points = [];
    
    try {
      for (let i = 0; i < pointCount; i++) {
        let x, y, z = 0, r, g, b;
        let statusByte;

        // Read coordinates based on format
        if (formatCode === 0 || formatCode === 4) { // 3D formats
          x = view.getInt16(offset, false);
          y = view.getInt16(offset + 2, false);
          z = view.getInt16(offset + 4, false);
          statusByte = view.getUint8(offset + 6);
          offset += 7;
        } else { // 2D formats
          x = view.getInt16(offset, false);
          y = view.getInt16(offset + 2, false);
          statusByte = view.getUint8(offset + 4);
          offset += 5;
        }

        const blanking = (statusByte & 64) === 64;
        const lastPoint = (statusByte & 128) === 128;

        // Read color data
        if (formatCode === 0 || formatCode === 1) { // Indexed Color
          const colorIndex = view.getUint8(offset);
          offset += 1;
          const color = defaultPalette[colorIndex % defaultPalette.length] || defaultPalette[0];
          r = color.r;
          g = color.g;
          b = color.b;
        } else if (formatCode === 4 || formatCode === 5) { // True Color formats
			// FIX: The byte order in ILDA files is typically B, G, R (not R, G, B)
			b = view.getUint8(offset);
			g = view.getUint8(offset + 1);
			r = view.getUint8(offset + 2);
			offset += 3;
			
			// Debug log to see what colors we're reading
		} else if (formatCode === 2) {
          // Color table entry - skip
          offset += 3;
          continue;
        }

        points.push({ 
          x, y, z, 
          r: r || 255, g: g || 255, b: b || 255,
          blanking, 
          lastPoint 
        });
      }
    } catch (error) {
      console.warn("Parser: Error reading points:", error);
      break;
    }

    if (points.length > 0) {
      frames.push({ 
        frameNumber, 
        totalFrames, 
        projectorNumber,
        points 
      });
    }
  }
  return { frames, error: frames.length === 0 ? 'No valid frames found' : null };
};