const defaultPalette = [
  { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 255, g: 128, b: 0 }, { r: 128, g: 255, b: 0 },
  { r: 0, g: 255, b: 128 }, { r: 0, g: 128, b: 255 }, { r: 128, g: 0, b: 255 }, { r: 255, g: 0, b: 128 },
  { r: 255, g: 255, b: 255 }, { r: 128, g: 128, b: 128 }, { r: 255, g: 128, b: 128 }, { r: 128, g: 255, b: 128 },
  { r: 128, g: 128, b: 255 }, { r: 255, g: 255, b: 128 }, { r: 128, g: 255, b: 255 }, { r: 255, g: 128, b: 255 },
];

const ildaDataStore = new Map(); // Store parsed ILDA data by a unique ID

const calculateBounds = (points) => {
  if (!points || points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
};

function parseIldaFile(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const frames = [];
  let currentOffset = 0;

  while (currentOffset + 32 <= arrayBuffer.byteLength) { // Ensure at least 32 bytes for a header
    const frameStartOffset = currentOffset;

    // Check for ILDA signature "ILDA"
    const signature = String.fromCharCode(
      view.getUint8(frameStartOffset),
      view.getUint8(frameStartOffset + 1),
      view.getUint8(frameStartOffset + 2),
      view.getUint8(frameStartOffset + 3)
    );

    if (signature !== 'ILDA') {
      console.warn(`Parser: Invalid ILDA signature at offset ${frameStartOffset}, got: ${signature}. Skipping 32 bytes.`);
      currentOffset += 32; // Skip this invalid header
      continue;
    }

    // Verify format byte
    const formatCode = view.getUint8(frameStartOffset + 7);
    if (formatCode > 5) {
      console.warn(`Parser: Unknown format code: ${formatCode} at offset ${frameStartOffset}. Skipping 32 bytes.`);
      currentOffset += 32; // Skip this header and try next
      continue;
    }

    let pointCount = view.getUint16(frameStartOffset + 24, false); // Big-endian
    const frameNumber = view.getUint16(frameStartOffset + 26, false);
    const totalFrames = view.getUint16(frameStartOffset + 28, false);
    const projectorNumber = view.getUint8(frameStartOffset + 30); // Usually 0

    // Calculate record size based on format
    let recordSize;
    switch (formatCode) {
      case 0: recordSize = 8; break;  // 3D Indexed Color
      case 1: recordSize = 6; break;  // 2D Indexed Color  
      case 2: recordSize = 8; break;  // Color Palette (skip)
      case 4: recordSize = 10; break; // 3D True Color
      case 5: recordSize = 8; break;  // 2D True Color
      default:
        console.warn(`Parser: Unsupported format ${formatCode}, skipping 32 bytes.`);
        currentOffset += 32; // Skip this header and try next
        continue;
    }

    let pointsDataSize = pointCount * recordSize;
    let frameTotalSize = 32 + pointsDataSize;

    // Heuristic to handle malformed files with incorrect point counts
    const remainingBytes = arrayBuffer.byteLength - currentOffset;
    if (frameTotalSize < remainingBytes) {
        const leftover = remainingBytes - frameTotalSize;
        if (leftover > 0 && leftover <= 32) {
            console.warn(`Parser: Malformed frame, ${leftover} leftover bytes. Adjusting size.`);
            frameTotalSize += leftover;
            pointsDataSize += leftover;
            pointCount = Math.floor(pointsDataSize / recordSize);
        }
    }


    // Check if we have enough data for all points
    if (frameStartOffset + frameTotalSize > arrayBuffer.byteLength) {
      console.warn(`Parser: Incomplete frame data for ${pointCount} points at offset ${frameStartOffset}. Expected ${frameTotalSize} bytes, but only ${arrayBuffer.byteLength - frameStartOffset} bytes remaining. Breaking.`);
      break; // Not enough data for this frame, stop parsing
    }

    if (pointCount === 0) {
      console.log("Parser: Empty frame, skipping");
      currentOffset += frameTotalSize; // Skip empty frame
      continue;
    }

    const points = [];
    let pointDataOffset = frameStartOffset + 32; // Start of point data for current frame
    
    try {
      for (let i = 0; i < pointCount; i++) {
        let x, y, z = 0, r, g, b;
        let statusByte;

        // Read coordinates based on format
        if (formatCode === 0 || formatCode === 4) { // 3D formats
          x = view.getInt16(pointDataOffset, false) / 32768;
          y = view.getInt16(pointDataOffset + 2, false) / 32768;
          z = view.getInt16(pointDataOffset + 4, false) / 32768;
          statusByte = view.getUint8(pointDataOffset + 6);
        } else { // 2D formats
          x = view.getInt16(pointDataOffset, false) / 32768;
          y = view.getInt16(pointDataOffset + 2, false) / 32768;
          statusByte = view.getUint8(pointDataOffset + 4);
        }

        const blanking = (statusByte & 64) === 64;
        const lastPoint = (statusByte & 128) === 128;

        // Read color data
        if (formatCode === 0 || formatCode === 1) { // Indexed Color
          const colorIndex = view.getUint8(pointDataOffset + (formatCode === 0 ? 7 : 5));
          const color = defaultPalette[colorIndex % defaultPalette.length] || defaultPalette[0];
          r = color.r;
          g = color.g;
          b = color.b;
        } else if (formatCode === 4 || formatCode === 5) { // True Color formats
			r = view.getUint8(pointDataOffset + (formatCode === 4 ? 7 : 5));
			g = view.getUint8(pointDataOffset + (formatCode === 4 ? 8 : 6));
			b = view.getUint8(pointDataOffset + (formatCode === 4 ? 9 : 7));
		} else if (formatCode === 2) {
          // Color table entry - skip
          pointDataOffset += recordSize;
          continue;
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
      break;
    }

    if (points.length > 0) {
      frames.push({ 
        frameNumber, 
        totalFrames, 
        projectorNumber,
        points,
        bounds: calculateBounds(points)
      });
    }
    currentOffset += frameTotalSize; // Advance offset by the size of the entire frame
  }
  return { frames, error: frames.length === 0 ? 'No valid frames found' : null };
}


self.onmessage = function(e) {

  const { arrayBuffer, type, fileName, layerIndex, colIndex, workerId, frameIndex } = e.data;
  
  if (type === 'parse-ilda') {
    try {
      const parsedData = parseIldaFile(arrayBuffer);
      const newWorkerId = `ilda-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      ildaDataStore.set(newWorkerId, parsedData.frames);

      self.postMessage({ 
        success: true, 
        workerId: newWorkerId, 
        totalFrames: parsedData.frames.length, 
        fileName: fileName, 
        layerIndex, 
        colIndex,
        type: 'parse-ilda' 
      });
    } catch (error) {
      console.error('[ilda-parser.worker] Error parsing file:', error);
      self.postMessage({ success: false, error: error.message });
    }
  } else if (type === 'get-frame') {
    const frames = ildaDataStore.get(workerId);
    if (frames && frames[frameIndex]) {
      self.postMessage({ success: true, frame: frames[frameIndex], workerId, frameIndex, type: 'get-frame' });
    } else {
      self.postMessage({ success: false, error: 'Frame not found', workerId, frameIndex });
    }
  }
};