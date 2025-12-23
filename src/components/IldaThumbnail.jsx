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

    const scaleX = width / 2;
    const scaleY = height / 2;
    const offsetX = width / 2;
    const offsetY = height / 2;

    const points = frame.points;
    const isTyped = points instanceof Float32Array || frame.isTypedArray;
    const numPoints = isTyped ? (points.length / 8) : points.length;

    const getPointData = (idx) => {
        if (isTyped) {
            const offset = idx * 8;
            return {
                x: points[offset],
                y: points[offset + 1],
                r: points[offset + 3],
                g: points[offset + 4],
                b: points[offset + 5],
                blanking: points[offset + 6] === 1
            };
        } else {
            return points[idx];
        }
    };

    for (let i = 0; i < numPoints; i++) {
      const point = getPointData(i);
      const prevPoint = i > 0 ? getPointData(i - 1) : null;

      if (point.blanking) {
        continue;
      }

      const isGenerated = Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
      const x = (isGenerated ? point.x : point.x / 32767.0) * scaleX + offsetX;
      const y = (isGenerated ? -point.y : -point.y / 32767.0) * scaleY + offsetY; // Invert Y-coordinate
      const color = `rgb(${point.r}, ${point.g}, ${point.b})`;

      let prevX, prevY; // Declare here

      if (prevPoint && !prevPoint.blanking) {
        // Previous point was visible, so draw a line
        const isPrevGenerated = Math.abs(prevPoint.x) <= 1 && Math.abs(prevPoint.y) <= 1;
        prevX = (isPrevGenerated ? prevPoint.x : prevPoint.x / 32767.0) * scaleX + offsetX;
        prevY = (isPrevGenerated ? -prevPoint.y : -prevPoint.y / 32767.0) * scaleY + offsetY; // Invert Y-coordinate
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
