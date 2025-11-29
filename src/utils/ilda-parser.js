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

  while (offset < view.byteLength) {
    if (offset + 32 > view.byteLength) {
      break; 
    }

    if (view.getUint8(offset) !== 73 || view.getUint8(offset + 1) !== 76 || view.getUint8(offset + 2) !== 68 || view.getUint8(offset + 3) !== 65 || view.getUint8(offset + 4) !== 0 || view.getUint8(offset + 5) !== 0 || view.getUint8(offset + 6) !== 0) {
      offset++;
      continue; 
    }

    const formatCode = view.getUint8(offset + 7);
    const pointCount = view.getUint16(offset + 24, false);
    const frameNumber = view.getUint16(offset + 26, false);
    const totalFrames = view.getUint16(offset + 28, false); // New

    if (pointCount === 0) {
        break;
    }

    

    offset += 32; 

    const points = [];
    let recordSize = 0;

    if (formatCode === 0) recordSize = 8; // 3D Indexed
    else if (formatCode === 1) recordSize = 6; // 2D Indexed
    else if (formatCode === 4) recordSize = 10; // 3D True Color
    else if (formatCode === 5) recordSize = 8; // 2D True Color
    else if (formatCode === 2) { 
        offset += pointCount * 3;
        continue;
    }
    else { 
        console.warn(`Parser: Unsupported ILDA format: ${formatCode}. Skipping this section.`);
        // To avoid infinite loop, advance offset by a minimal amount if recordSize is 0
        offset += 1; 
        continue; 
    }

    try {
      for (let i = 0; i < pointCount; i++) {
        let x, y, z = 0;
        let statusByte, r, g, b;

        if (formatCode === 0 || formatCode === 4) { // 3D formats
          x = view.getInt16(offset, false);
          y = view.getInt16(offset + 2, false);
          z = view.getInt16(offset + 4, false);
          statusByte = view.getUint8(offset + 6);
          offset += 7;
        } else if (formatCode === 1 || formatCode === 5) { // 2D formats
          x = view.getInt16(offset, false);
          y = view.getInt16(offset + 2, false);
          statusByte = view.getUint8(offset + 4);
          offset += 5;
        }

        const blanking = (statusByte & 64) === 64; // Bit 6 is the blanking bit
        const lastPoint = (statusByte & 128) === 128; // Bit 7 is the last point bit

        if (formatCode === 0 || formatCode === 1) { // Indexed Color formats
          const colorIndex = view.getUint8(offset);
          offset += 1;
          const color = defaultPalette[colorIndex % defaultPalette.length] || defaultPalette[0];
          r = color.r;
          g = color.g;
          b = color.b;
        } else if (formatCode === 4 || formatCode === 5) { // True Color formats
          b = view.getUint8(offset);
          g = view.getUint8(offset + 1);
          r = view.getUint8(offset + 2);
          offset += 3;
        }

        points.push({ x, y, z, r, g, b, blanking, lastPoint });
      }
    } catch (e) {
      if (e instanceof RangeError) {
        console.warn("Parser: Reached end of file while reading points.");
      } else {
        throw e;
      }
    }

    frames.push({ frameNumber, totalFrames, points });
  }

  return { frames };
};
