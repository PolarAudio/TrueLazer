import React, { useEffect, useRef } from 'react';

const IldaThumbnail = ({ frame }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !frame || !frame.points || frame.points.length === 0) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1.5;

    for (let i = 0; i < frame.points.length; i++) {
      const point = frame.points[i];
      const prevPoint = i > 0 ? frame.points[i - 1] : null;

      if (point.blanking) {
        continue;
      }

      const x = ((point.x + 32768) / 65535) * width;
      const y = height - (((point.y + 32768) / 65535) * height);
      const color = `rgb(${point.r}, ${point.g}, ${point.b})`;

      if (prevPoint && !prevPoint.blanking) {
        // Previous point was visible, so draw a line
        const prevX = ((prevPoint.x + 32768) / 65535) * width;
        const prevY = height - (((prevPoint.y + 32768) / 65535) * height);
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        // Previous point was blanked or this is the first point, so draw a dot
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 2, 2); // Draw a 2x2 dot for visibility
      }
    }
  }, [frame]);

  return (
    <canvas ref={canvasRef} width="100" height="100" style={{ backgroundColor: 'black' }} />
  );
};

export default IldaThumbnail;
