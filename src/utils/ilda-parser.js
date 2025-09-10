const defaultPalette = [
  { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 255, g: 128, b: 0 }, { r: 128, g: 255, b: 0 },
  { r: 0, g: 255, b: 128 }, { r: 0, g: 128, b: 255 }, { r: 128, g: 0, b: 255 }, { r: 255, g: 0, b: 128 },
  { r: 255, g: 255, b: 255 }, { r: 128, g: 128, b: 128 }, { r: 255, g: 128, b: 128 }, { r: 128, g: 255, b: 128 },
  { r: 128, g: 128, b: 255 }, { r: 255, g: 255, b: 128 }, { r: 128, g: 255, b: 255 }, { r: 255, g: 128, b: 255 },
];

export const parseIldaFile = (fileContent) => {
  const view = new DataView(fileContent);

  const protocol = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (protocol !== 'ILDA') {
    return { error: 'Unsupported ILDA file format: Protocol must be ILDA.' };
  }

  const format = view.getUint8(7);
  const validFormats = [0, 1, 2, 4, 5];
  if (!validFormats.includes(format)) {
    throw new Error(`Invalid format code: ${format}`);
  }

  let frameName = '';
  for (let i = 0; i < 8; i++) {
    frameName += String.fromCharCode(view.getUint8(8 + i));
  }

  let companyName = '';
  for (let i = 0; i < 8; i++) {
    companyName += String.fromCharCode(view.getUint8(16 + i));
  }

  const totalPoints = view.getUint16(24, false);
  const frameNumber = view.getUint16(26, false);
  const totalFrames = view.getUint16(28, false);
  const scannerHead = view.getUint8(30);

  const points = [];
  let recordOffset = 32;
  let recordSize = 0;

  console.log(`Parsing frame: totalPoints=${totalPoints}, fileLength=${fileContent.byteLength}`);

  for (let i = 0; recordOffset + recordSize <= fileContent.byteLength && i < totalPoints; i++) {
    let point = {};

    switch (format) {
      case 0: // 3D, BGR color
        recordSize = 10;
        point.x = view.getInt16(recordOffset, false);
        point.y = view.getInt16(recordOffset + 2, false);
        point.z = view.getInt16(recordOffset + 4, false);
        point.status = view.getUint8(recordOffset + 6);
        point.b = view.getUint8(recordOffset + 7);
        point.g = view.getUint8(recordOffset + 8);
        point.r = view.getUint8(recordOffset + 9);
        break;
      case 1: // 2D, BGR color
        recordSize = 8;
        point.x = view.getInt16(recordOffset, false);
        point.y = view.getInt16(recordOffset + 2, false);
        point.status = view.getUint8(recordOffset + 4);
        point.b = view.getUint8(recordOffset + 5);
        point.g = view.getUint8(recordOffset + 6);
        point.r = view.getUint8(recordOffset + 7);
        break;
      case 2: // Color palette
        const palette = [];
        for (let j = 0; j < totalPoints; j++) {
          const r = view.getUint8(recordOffset + j * 3);
          const g = view.getUint8(recordOffset + j * 3 + 1);
          const b = view.getUint8(recordOffset + j * 3 + 2);
          palette.push({ r, g, b });
        }
        return {
          format,
          totalPoints,
          palette,
        };
      case 4: // 3D, indexed color
        recordSize = 8;
        point.x = view.getInt16(recordOffset, false);
        point.y = view.getInt16(recordOffset + 2, false);
        point.z = view.getInt16(recordOffset + 4, false);
        point.status = view.getUint8(recordOffset + 6);
        point.color = view.getUint8(recordOffset + 7);
        break;
      case 5: // 2D, indexed color
        recordSize = 6;
        point.x = view.getInt16(recordOffset, false);
        point.y = view.getInt16(recordOffset + 2, false);
        point.status = view.getUint8(recordOffset + 4);
        point.color = view.getUint8(recordOffset + 5);
        break;
    }
    if (recordSize > 0) {
      points.push(point);
      recordOffset += recordSize;
    }
  }

  return {
    protocol,
    format,
    frameName,
    companyName,
    totalPoints: points.length, // Return actual points read
    frameNumber,
    totalFrames,
    scannerHead,
    points,
  };
};