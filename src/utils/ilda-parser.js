const defaultPalette = [
  { r: 255, g: 0, b: 0 }, { r: 255, g: 17, b: 0 }, { r: 255, g: 34, b: 0 }, { r: 255, g: 51, b: 0 },
  { r: 255, g: 68, b: 0 }, { r: 255, g: 85, b: 0 }, { r: 255, g: 102, b: 0 }, { r: 255, g: 119, b: 0 },
  { r: 255, g: 136, b: 0 }, { r: 255, g: 153, b: 0 }, { r: 255, g: 170, b: 0 }, { r: 255, g: 187, b: 0 },
  { r: 255, g: 204, b: 0 }, { r: 255, g: 221, b: 0 }, { r: 255, g: 238, b: 0 }, { r: 255, g: 255, b: 0 },
  { r: 255, g: 255, b: 0 }, { r: 238, g: 255, b: 0 }, { r: 204, g: 255, b: 0 }, { r: 170, g: 255, b: 0 },
  { r: 136, g: 255, b: 0 }, { r: 102, g: 255, b: 0 }, { r: 68, g: 255, b: 0 }, { r: 34, g: 255, b: 0 },
  { r: 0, g: 255, b: 0 }, { r: 0, g: 255, b: 34 }, { r: 0, g: 255, b: 68 }, { r: 0, g: 255, b: 102 },
  { r: 0, g: 255, b: 136 }, { r: 0, g: 255, b: 170 }, { r: 0, g: 255, b: 204 }, { r: 0, g: 255, b: 238 },
  { r: 0, g: 136, b: 255 }, { r: 0, g: 119, b: 255 }, { r: 0, g: 102, b: 255 }, { r: 0, g: 102, b: 255 },
  { r: 0, g: 85, b: 255 }, { r: 0, g: 68, b: 255 }, { r: 0, g: 68, b: 255 }, { r: 0, g: 34, b: 255 },
  { r: 0, g: 0, b: 255 }, { r: 34, g: 0, b: 255 }, { r: 68, g: 0, b: 255 }, { r: 102, g: 0, b: 255 },
  { r: 136, g: 0, b: 255 }, { r: 170, g: 0, b: 255 }, { r: 204, g: 0, b: 255 }, { r: 238, g: 0, b: 255 },
  { r: 255, g: 0, b: 255 }, { r: 255, g: 34, b: 255 }, { r: 255, g: 68, b: 255 }, { r: 255, g: 102, b: 255 },
  { r: 255, g: 136, b: 255 }, { r: 255, g: 170, b: 255 }, { r: 255, g: 204, b: 255 }, { r: 255, g: 238, b: 255 },
  { r: 255, g: 255, b: 255 }, { r: 255, g: 238, b: 238 }, { r: 255, g: 204, b: 204 }, { r: 255, g: 170, b: 170 },
  { r: 255, g: 136, b: 136 }, { r: 255, g: 102, b: 102 }, { r: 255, g: 68, b: 68 }, { r: 0, g: 34, b: 34 },
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

      // Read color data
      if (blanking) {
		  r = 0; g = 0; b = 0;
	  } else {
		if (formatCode === 0 || formatCode === 1) { // Indexed Color
			const colorIndex = view.getUint8(pointDataOffset + (formatCode === 0 ? 7 : 5));
			const palette = colorPalette || defaultPalette;
			const color = palette[colorIndex % palette.length] || defaultPalette[0];
			r = color.r; g = color.g; b = color.b;
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
	  
      if (lastPoint) break; 
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
  let activePalette = null;
  let firstFormatCode = null;

  while (offset + 32 <= view.byteLength) {
    const signature = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    if (signature !== 'ILDA') {
      offset++; continue; 
    }

    const formatCode = view.getUint8(offset + 7);
    if (firstFormatCode === null) firstFormatCode = formatCode;

    const frameName = String.fromCharCode(...new Uint8Array(arrayBuffer, offset + 8, 8)).trim();
    const companyName = String.fromCharCode(...new Uint8Array(arrayBuffer, offset + 16, 8)).trim();
    let pointCount = view.getUint16(offset + 24, false);
    const frameNumber = view.getUint16(offset + 26, false);
    const totalFrames = view.getUint16(offset + 28, false);
    const scannerHead = view.getUint8(offset + 30);

    let recordSize;
    switch (formatCode) {
      case 0: recordSize = 8; break;
      case 1: recordSize = 6; break;
      case 2: recordSize = 4; break;
      case 4: recordSize = 10; break;
      case 5: recordSize = 8; break;
      default: offset += 32; continue;
    }

    if (formatCode === 2) {
      activePalette = [];
	  const paletteStart = offset + 32;
      for (let i = 0; i < pointCount; i++) {
        const r = view.getUint8(paletteStart + i * 4);
        const g = view.getUint8(paletteStart + i * 4 + 1);
        const b = view.getUint8(paletteStart + i * 4 + 2);
        activePalette.push({ r, g, b });
      }
    }

    let pointsDataSize = pointCount * recordSize;
    let frameTotalSize = 32 + pointsDataSize;

    if (offset + frameTotalSize > arrayBuffer.byteLength) break;

    if (pointCount > 0 && formatCode !== 2) {
        const pointDataBuffer = arrayBuffer.slice(offset + 32, offset + 32 + pointsDataSize);
        const points = parseFramePoints(pointDataBuffer, formatCode, recordSize, pointCount, activePalette);
        frames.push({ frameName, companyName, frameNumber, totalFrames, scannerHead, points, formatCode });
    }

    offset += frameTotalSize;
  }

  return { frames, firstFormatCode, colorPalette: activePalette };
};
