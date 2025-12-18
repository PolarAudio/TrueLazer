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

function parseIldaFile(arrayBuffer) {
  console.log('[ilda-parser.worker.js] parseIldaFile - Starting parsing.'); // DEBUG LOG
  const view = new DataView(arrayBuffer);
  const framesMetadata = []; // Will store metadata about frames, not parsed points
  let firstFormatCode = null;
  let currentOffset = 0;
  let colorPalette = null;

  while (currentOffset + 32 <= arrayBuffer.byteLength) {
    const frameStartOffset = currentOffset;

    const signature = String.fromCharCode(
      view.getUint8(frameStartOffset),
      view.getUint8(frameStartOffset + 1),
      view.getUint8(frameStartOffset + 2),
      view.getUint8(frameStartOffset + 3)
    );

    if (signature !== 'ILDA') {
      console.warn(`[ilda-parser.worker.js] Parser: Invalid ILDA signature at offset ${frameStartOffset}, got: ${signature}. Skipping 32 bytes.`);
      currentOffset += 32;
      continue;
    }

    const formatCode = view.getUint8(frameStartOffset + 7);
    if (firstFormatCode === null) {
      firstFormatCode = formatCode;
    }

    if (formatCode > 5) {
      console.warn(`[ilda-parser.worker.js] Parser: Unknown format code: ${formatCode} at offset ${frameStartOffset}. Skipping 32 bytes.`);
      currentOffset += 32;
      continue;
    }

    const frameName = String.fromCharCode(...new Uint8Array(arrayBuffer, frameStartOffset + 8, 8)).trim();
    const companyName = String.fromCharCode(...new Uint8Array(arrayBuffer, frameStartOffset + 16, 8)).trim();
    let pointCount = view.getUint16(frameStartOffset + 24, false);
    const frameNumber = view.getUint16(frameStartOffset + 26, false);
    const totalFrames = view.getUint16(frameStartOffset + 28, false);
    const scannerHead = view.getUint8(frameStartOffset + 30);

    let recordSize;
    switch (formatCode) {
      case 0: recordSize = 8; break;
      case 1: recordSize = 6; break;
      case 2: recordSize = 4; break;
      case 4: recordSize = 10; break;
      case 5: recordSize = 8; break;
      default:
        console.warn(`Parser: Unsupported format ${formatCode}, skipping 32 bytes.`);
        currentOffset += 32;
        continue;
    }

    if (formatCode === 2) {
      colorPalette = [];
	  const paletteStart = currentOffset + 32;
      for (let i = 0; i < pointCount; i++) {
        const r = view.getUint8(paletteStart + i * 4); 		//Byte 0: Red
        const g = view.getUint8(paletteStart + i * 4 + 1);	//Byte 1: Green
        const b = view.getUint8(paletteStart + i * 4 + 2);	//Byte 2: Blue
		//Byte 3 is reserved, skip it
        colorPalette.push({ r, g, b });
      }
    }

    let pointsDataSize = pointCount * recordSize;
    let frameTotalSize = 32 + pointsDataSize;

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

    if (frameStartOffset + frameTotalSize > arrayBuffer.byteLength) {
      console.warn(`Parser: Incomplete frame data for ${pointCount} points at offset ${frameStartOffset}. Expected ${frameTotalSize} bytes, but only ${arrayBuffer.byteLength - frameStartOffset} bytes remaining. Breaking.`);
      break;
    }

    if (pointCount === 0) {
      console.log("[ilda-parser.worker.js] Parser: Empty frame, skipping");
      currentOffset += frameTotalSize;
      continue;
    }

    framesMetadata.push({ 
        frameName,
        companyName,
        frameNumber, 
        totalFrames, 
        scannerHead,
        formatCode,
        recordSize,
        pointCount,
        pointDataOffset: frameStartOffset + 32, // Store offset to actual point data
        pointDataSize: pointsDataSize,
        frameEndOffset: frameStartOffset + frameTotalSize,
        // We no longer store pointDataBuffer slice here
        bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } // Placeholder, calculated on demand
    });
    currentOffset += frameTotalSize;
  }
  console.log(`[ilda-parser.worker.js] parseIldaFile - Finished parsing. Found ${framesMetadata.length} frames.`);
  return { frames: framesMetadata, error: framesMetadata.length === 0 ? 'No valid frames found' : null, firstFormatCode, ildaFileBuffer: arrayBuffer, colorPalette };
}


const pendingFileRequests = new Map();

self.onmessage = function(e) {
  const { arrayBuffer, type, fileName, filePath, layerIndex, colIndex, workerId, frameIndex, isStillFrame, requestId } = e.data;

  if (type === 'parse-ilda') {
    // This case now expects arrayBuffer to be present
    if (!arrayBuffer) {
      self.postMessage({ success: false, error: 'ArrayBuffer missing for parse-ilda command', type: 'parse-ilda' });
      return;
    }
    try {
      console.log('[ilda-parser.worker.js] Calling parseIldaFile for:', fileName); // DEBUG LOG
      const parsedData = parseIldaFile(arrayBuffer); // This now returns framesMetadata and ildaFileBuffer
      const newWorkerId = `ilda-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      ildaDataStore.set(newWorkerId, {ildaFileBuffer: parsedData.ildaFileBuffer, framesMetadata: parsedData.frames, colorPalette: parsedData.colorPalette}); // Store full buffer and metadata
      console.log('[ilda-parser.worker.js] Posting success message for parse-ilda.'); // DEBUG LOG
      self.postMessage({ 
        success: true, 
        workerId: newWorkerId, 
        totalFrames: parsedData.frames.length, 
        ildaFormat: parsedData.firstFormatCode, // Add the format code here
        fileName: fileName,
        filePath: filePath,
        layerIndex, 
        colIndex,
        type: 'parse-ilda' 
      });
      self.postMessage({ type: 'parsing-status', status: false, layerIndex, colIndex }); // Parsing finished
    } catch (error) {
      console.error('[ilda-parser.worker.js] Error parsing file in onmessage handler:', error); // DEBUG LOG
      self.postMessage({ success: false, error: error.message, type: 'parse-ilda' });
      self.postMessage({ type: 'parsing-status', status: false, layerIndex, colIndex }); // Parsing finished with error
    }
  } else if (type === 'load-and-parse-ilda') {
    // Worker requests file content from main process (via renderer)
    const newRequestId = Math.random().toString(36).substring(2, 15);
    pendingFileRequests.set(newRequestId, { fileName, filePath, layerIndex, colIndex });
    // Inform renderer that parsing has started for this clip
    self.postMessage({ type: 'parsing-status', status: true, layerIndex, colIndex });
    self.postMessage({ type: 'request-file-content', filePath, requestId: newRequestId });
  } else if (type === 'file-content-response') {
    // Main process (renderer) sends file content back to worker
    const requestContext = pendingFileRequests.get(requestId);
    if (!requestContext) {
      console.error(`Worker: No context found for requestId: ${requestId}`);
      return;
    }
    pendingFileRequests.delete(requestId);

    if (e.data.error) {
      console.error(`Worker: Error receiving file content: ${e.data.error}`);
      self.postMessage({ success: false, error: e.data.error, type: 'parse-ilda', ...requestContext });
      self.postMessage({ type: 'parsing-status', status: false, layerIndex: requestContext.layerIndex, colIndex: requestContext.colIndex }); // Parsing finished with error
      return;
    }

    try {
      console.log(`[ilda-parser.worker.js] Calling parseIldaFile for: ${requestContext.fileName} (from file-content-response)`);
      const parsedData = parseIldaFile(arrayBuffer); // This now returns framesMetadata and ildaFileBuffer
      const newWorkerId = `ilda-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      ildaDataStore.set(newWorkerId, {ildaFileBuffer: parsedData.ildaFileBuffer, framesMetadata: parsedData.frames, colorPalette: parsedData.colorPalette}); // Store full buffer and metadata
      self.postMessage({ 
        success: true, 
        workerId: newWorkerId, 
        totalFrames: parsedData.frames.length, 
        ildaFormat: parsedData.firstFormatCode, 
        type: 'parse-ilda',
        ...requestContext 
      });
      self.postMessage({ type: 'parsing-status', status: false, layerIndex: requestContext.layerIndex, colIndex: requestContext.colIndex }); // Parsing finished
    } catch (error) {
      console.error('[ilda-parser.worker.js] Error parsing file from content response:', error);
      self.postMessage({ success: false, error: error.message, type: 'parse-ilda', ...requestContext });
      self.postMessage({ type: 'parsing-status', status: false, layerIndex: requestContext.layerIndex, colIndex: requestContext.colIndex }); // Parsing finished with error
    }
  } else if (type === 'get-frame') {
    const ildaData = ildaDataStore.get(workerId);
    if (!ildaData) {
      self.postMessage({ success: false, error: 'ILDA data not found', type: 'get-frame', workerId });
      return;
    }

    const { ildaFileBuffer, framesMetadata, colorPalette } = ildaData;
    if (frameIndex >= framesMetadata.length || frameIndex < 0) {
      self.postMessage({ success: false, error: `Frame index ${frameIndex} out of bounds`, type: 'get-frame', workerId });
      return;
    }

    const frameMeta = framesMetadata[frameIndex];
    const pointDataBuffer = ildaFileBuffer.slice(frameMeta.pointDataOffset, frameMeta.pointDataOffset + frameMeta.pointDataSize);
    const points = parseFramePoints(pointDataBuffer, frameMeta.formatCode, frameMeta.recordSize, frameMeta.pointCount, colorPalette);

    const frame = {
        points: points,
        // Add other frame properties as needed
    };
    

    self.postMessage({ success: true, frame, type: 'get-frame', workerId, frameIndex, isStillFrame, layerIndex, colIndex });
  }
};