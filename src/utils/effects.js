const applyRotate = (frame, angle, axis) => {
  const newFrame = JSON.parse(JSON.stringify(frame)); // Deep copy

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  newFrame.points = newFrame.points.map(p => {
    const x = p.x;
    const y = p.y;
    const z = p.z || 0;

    let newX, newY, newZ;

    switch (axis) {
      case 'x':
        newX = x;
        newY = y * cosA - z * sinA;
        newZ = y * sinA + z * cosA;
        break;
      case 'y':
        newX = x * cosA + z * sinA;
        newY = y;
        newZ = -x * sinA + z * cosA;
        break;
      case 'z':
      default:
        newX = x * cosA - y * sinA;
        newY = x * sinA + y * cosA;
        newZ = z;
        break;
    }

    return { ...p, x: newX, y: newY, z: newZ };
  });

  return newFrame;
};

const applyScale = (frame, scaleX, scaleY, scaleZ) => {
  const newFrame = JSON.parse(JSON.stringify(frame)); // Deep copy

  newFrame.points = newFrame.points.map(p => {
    const x = p.x * scaleX;
    const y = p.y * scaleY;
    const z = (p.z || 0) * scaleZ;
    return { ...p, x, y, z };
  });

  return newFrame;
};

const applyTransform = (frame, translateX, translateY, translateZ) => {
  const newFrame = JSON.parse(JSON.stringify(frame)); // Deep copy

  newFrame.points = newFrame.points.map(p => {
    const x = p.x + translateX;
    const y = p.y + translateY;
    const z = (p.z || 0) + translateZ;
    return { ...p, x, y, z };
  });

  return newFrame;
};

export {
  applyRotate,
  applyScale,
  applyTransform,
};
