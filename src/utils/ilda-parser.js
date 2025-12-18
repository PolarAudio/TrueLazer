const defaultPalette = [
  { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 255, g: 128, b: 0 }, { r: 128, g: 255, b: 0 },
  { r: 0, g: 255, b: 128 }, { r: 0, g: 128, b: 255 }, { r: 128, g: 0, b: 255 }, { r: 255, g: 0, b: 128 },
  { r: 255, g: 255, b: 255 }, { r: 128, g: 128, b: 128 }, { r: 255, g: 128, b: 128 }, { r: 128, g: 255, b: 128 },
  { r: 128, g: 128, b: 255 }, { r: 255, g: 255, b: 128 }, { r: 128, g: 255, b: 255 }, { r: 255, g: 128, b: 255 },
];

// Helper function to parse points from a DataView slice
function parseFramePoints(pointDataBuffer, formatCode, recordSize, pointCount, colorPalette = defaultPalette) {
  const points = [];
  const view = new DataView(pointDataBuffer);
  let pointDataOffset = 0;

  try {
    for (let i = 0; i < pointCount; i++) {
      if (formatCode === 2) {
        pointDataOffset += recordSize;
        continue;
      }

      let x, y, z = 0, r, g, b;
      let statusByte;

      // Read coordinates based on format
      if (formatCode === 0 || formatCode === 4) { // 3D formats
        x = view.getInt16(pointDataOffset, false) / 32768;
        y = view.getInt16(pointDataOffset + 2, false) / 32768;
        z = view.getInt16(pointDataOffset + 4, false) / 32768;
        statusByte = view.getUint8(pointDataOffset + 6);
      } else { // 2D formats (1 and 5)
        x = view.getInt16(pointDataOffset, false) / 32768;
        y = view.getInt16(pointDataOffset + 2, false) / 32768;
        statusByte = view.getUint8(pointDataOffset + 4);
      }

      const blanking = (statusByte & 0x40) !== 0; // Bit 6
      const lastPoint = (statusByte & 0x80) !== 0; // Bit 7
	  if (blanking) {
		  r = 0;
		  g = 0;
		  b = 0;
	  } else {
      // Read color data
		if (formatCode === 0 || formatCode === 1) { // Indexed Color
			const colorIndex = view.getUint8(pointDataOffset + (formatCode === 0 ? 7 : 5));
			const palette = colorPalette || defaultPalette;
			const color = palette[colorIndex % palette.length] || defaultPalette[0];
			r = color.r;
			g = color.g;
			b = color.b;
		} else if (formatCode === 4 || formatCode === 5) { // True Color formats
			b = view.getUint8(pointDataOffset + (formatCode === 4 ? 7 : 5));
			g = view.getUint8(pointDataOffset + (formatCode === 4 ? 8 : 6));
			r = view.getUint8(pointDataOffset + (formatCode === 4 ? 9 : 7));
		}
	  }
      points.push({ 
        x, y, z, 
        r: r === undefined ? 255 : r, g: g === undefined ? 255 : g, b: b === undefined ? 255 : b,
        blanking, 
        lastPoint 
      });
      
      pointDataOffset += recordSize;
	  
      if (lastPoint) {
        break; // Stop processing points for this frame
      }
    }
  } catch (error) {
    console.warn("Parser: Error reading points:", error);
  }
  return points;
}

export const parseIldaFile = (arrayBuffer) => {
  const frames = [];
  const view = new DataView(arrayBuffer);
  let offset = 0;
  let colorPalette = null;

  while (offset < view.byteLength) {
    if (offset + 32 > view.byteLength) {
      break; 
    }

    const signature = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    if (signature !== 'ILDA') {
      offset++;
      continue; 
    }

    const formatCode = view.getUint8(offset + 7);
    const frameName = String.fromCharCode(...new Uint8Array(arrayBuffer, offset + 8, 8)).trim();
    const companyName = String.fromCharCode(...new Uint8Array(arrayBuffer, offset + 16, 8)).trim();
    const pointCount = view.getUint16(offset + 24, false);
    const frameNumber = view.getUint16(offset + 26, false);
    const totalFrames = view.getUint16(offset + 28, false);
    const scannerHead = view.getUint8(offset + 30);

    if (formatCode === 2) {
      colorPalette = [];
	  const paletteStart = currentOffset + 32;
      for (let i = 0; i < pointCount; i++) {
        const r = view.getUint8(paletteStart + i * 4);
        const g = view.getUint8(paletteStart + i * 4 + 1);
        const b = view.getUint8(paletteStart + i * 4 + 2);
        colorPalette.push({ r, g, b });
      }
    }

    if (pointCount === 0) {
        break;
    }

    

        offset += 32;
    
        if (formatCode === 2) {
            // Color palette record size is 4 bytes.
            // We read it above and now skip the data.
            offset += pointCount * 4;
            continue;
        }    else { 
        console.warn(`Parser: Unsupported ILDA format: ${formatCode}. Skipping this section.`);
        offset += 32; 
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

        const blanking = (statusByte & 0x01) !== 0; // Bit 0
        const lastPoint = (statusByte & 0x02) !== 0; // Bit 1
        console.log(`Status: ${statusByte.toString(2).padStart(8, '0')}, Blanking: ${blanking}, Last: ${lastPoint}`);

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

        points.push({
          x: x / 32768.0,
          y: y / 32768.0,
          z: z / 32768.0,
          r,
          g,
          b,
          blanking,
          lastPoint
        });

        if (lastPoint) {
          break;
        }
      }
    } catch (e) {
      if (e instanceof RangeError) {
        console.warn("Parser: Reached end of file while reading points.");
      } else {
        throw e;
      }
    }

    frames.push({ frameName, companyName, frameNumber, totalFrames, scannerHead, points, colorPalette });
  }

  return { frames, colorPalette };
};
