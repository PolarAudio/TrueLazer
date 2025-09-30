const createCircle = (radius = 10000, points = 100) => {
  const frame = {
    points: [],
  };

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const x = Math.round(radius * Math.cos(angle));
    const y = Math.round(radius * Math.sin(angle));

    frame.points.push({
      x,
      y,
      r: 255,
      g: 255,
      b: 255,
      blanking: false,
    });
  }

  return { frames: [frame] };
};

export {
  createCircle,
};
