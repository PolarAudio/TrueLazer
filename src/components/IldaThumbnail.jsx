import React, { useEffect, useRef } from 'react';

const IldaThumbnail = ({ frame }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    console.log('IldaThumbnail: Received frame prop:', frame); // Add this log
    if (!canvasRef.current || !frame || !frame.points || frame.points.length === 0) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1.5;

    const scaleX = width / 2;
    const scaleY = height / 2;
    const offsetX = width / 2;
    const offsetY = height / 2;

    for (let i = 0; i < frame.points.length; i++) {
      const point = frame.points[i];
      const prevPoint = i > 0 ? frame.points[i - 1] : null;

      if (point.blanking) {
        continue;
      }

      const x = point.x * scaleX + offsetX;
      const y = -point.y * scaleY + offsetY; // Invert Y-coordinate
      const color = `rgb(${point.r}, ${point.g}, ${point.b})`;

      let prevX, prevY; // Declare here

      if (prevPoint && !prevPoint.blanking) {
        // Previous point was visible, so draw a line
        prevX = prevPoint.x * scaleX + offsetX;
        prevY = -prevPoint.y * scaleY + offsetY; // Invert Y-coordinate
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        // Previous point was blanked or this is the first point, so draw a small line segment
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 1, y + 1); // Draw a tiny line segment to make it visible
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
  }, [frame]);

  return (
    <canvas ref={canvasRef} width="100" height="100" style={{ backgroundColor: 'black' }} />
  );
};

export default IldaThumbnail;
