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

    // Clear and set background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    // Initialize lastX, lastY to the center of the ILDA coordinate system (0,0)
    // which maps to the center of the canvas.
    let lastX = ((0 + 32768) / 65535) * width;
    let lastY = height - (((0 + 32768) / 65535) * height);
    let wasPenUp = true; // Track if the pen was up before the current point

    // Loop through all points and draw the complete frame at once
    for (let i = 0; i < frame.points.length; i++) {
      const currentPoint = frame.points[i];
      const x = ((currentPoint.x + 32768) / 65535) * width;
      const y = height - (((currentPoint.y + 32768) / 65535) * height);

      if (!currentPoint.blanking) { // If current point is visible
        const lineColor = `rgb(${currentPoint.r}, ${currentPoint.g}, ${currentPoint.b})`;

        if (wasPenUp) { // If this is the start of a new visible segment
          // Draw a dot for the isolated point
          ctx.fillStyle = lineColor;
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2); // Small circle
          ctx.fill();
        } else { // Continue drawing a line
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(x, y);
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 2; // Increased line width for visibility
          ctx.stroke();
        }
        wasPenUp = false; // Pen is now down
      } else { // If current point is blanked
        // console.log("Blanked point:", currentPoint); // Debug blanked points
        wasPenUp = true; // Pen is now up
      }
      
      // Always update lastX, lastY to the current point's coordinates
      lastX = x;
      lastY = y;
    }
  }, [frame]);

  return (
    <canvas ref={canvasRef} width="100" height="100" style={{ backgroundColor: 'black' }} />
  );
};

export default IldaThumbnail;
