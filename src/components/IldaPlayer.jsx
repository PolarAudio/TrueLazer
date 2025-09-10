import React, { useEffect, useRef } from 'react';
import { parseIldaFile } from '../utils/ilda-parser';

const defaultPalette = [
  { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 255, g: 128, b: 0 }, { r: 128, g: 255, b: 0 },
  { r: 0, g: 255, b: 128 }, { r: 0, g: 128, b: 255 }, { r: 128, g: 0, b: 255 }, { r: 255, g: 0, b: 128 },
  { r: 255, g: 255, b: 255 }, { r: 128, g: 128, b: 128 }, { r: 255, g: 128, b: 128 }, { r: 128, g: 255, b: 128 },
  { r: 128, g: 128, b: 255 }, { r: 255, g: 255, b: 128 }, { r: 128, g: 255, b: 255 }, { r: 255, g: 128, b: 255 },
];

const IldaPlayer = ({ parsedData, onUnsupportedFile }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!parsedData || parsedData.error) {
      // If there's no data or an error, clear the canvas and return.
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    if (parsedData && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const palette = parsedData.palette || defaultPalette;

      // Draw points
      ctx.beginPath();

      parsedData.points.forEach(point => {
        const x = ((point.x + 32768) / 65535) * canvas.width;
        const y = ((point.y + 32768) / 65535) * canvas.height;

        const isBlanking = (point.status & 0x40) !== 0;

        if (!isBlanking) {
          let color;
          if (parsedData.format === 4 || parsedData.format === 5) {
            color = palette[point.color];
          } else {
            color = { r: point.r, g: point.g, b: point.b };
          }

          ctx.strokeStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
          if ((point.status & 0x80) !== 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
      });

      ctx.stroke();
    }
  }, [parsedData, onUnsupportedFile]);

  return (
    <div className="ilda-player">
      <canvas ref={canvasRef} width="100" height="100"></canvas>
    </div>
  );
};

export default IldaPlayer;
