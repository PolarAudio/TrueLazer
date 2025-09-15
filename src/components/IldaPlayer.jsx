import React, { useEffect, useRef } from 'react';

const IldaPlayer = ({ ildaFrames, currentFrameIndex, showBeamEffect, beamAlpha, fadeAlpha, drawSpeed, onUpdateThumbnail }) => {
  const canvasRef = useRef(null);
  const animationFrameId = useRef(null);

  const frame = ildaFrames && ildaFrames[currentFrameIndex] ? ildaFrames[currentFrameIndex] : null;

  useEffect(() => {
    if (!canvasRef.current || !frame || !frame.points || frame.points.length === 0) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    // Clear canvas for new frame
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    let pointIndex = 0;
    // Initialize lastX, lastY to the center of the ILDA coordinate system (0,0)
    // which maps to the center of the canvas.
    let lastX = ((0 + 32768) / 65535) * width;
    let lastY = height - (((0 + 32768) / 65535) * height);
    let wasPenUp = true; // Track if the pen was up before the current point

    const renderSegment = () => {
      // Apply fading effect once per animation frame
      ctx.globalAlpha = fadeAlpha; // Use fadeAlpha prop
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      // Number of segments to draw per animation frame (for performance)
      // const drawSpeed = 1000; // Old hardcoded value

      for (let i = 0; i < drawSpeed; i++) {
        if (pointIndex >= frame.points.length) {
          pointIndex = 0; // Loop the frame animation
          // Reset lastX, lastY to the center for the start of the new frame
          lastX = ((0 + 32768) / 65535) * width;
          lastY = height - (((0 + 32768) / 65535) * height);
          wasPenUp = true; // Reset pen state for new frame
        }

        const currentPoint = frame.points[pointIndex];
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
              // Draw the beam effect
              if (showBeamEffect) {
                const centerX = width / 2;
                const centerY = height / 2;
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(lastX, lastY);
                ctx.lineTo(x, y);
                ctx.closePath();
                ctx.fillStyle = `rgba(${currentPoint.r}, ${currentPoint.g}, ${currentPoint.b}, ${beamAlpha})`;
                ctx.fill();
              }

              // Draw the line
              ctx.beginPath();
              ctx.moveTo(lastX, lastY);
              ctx.lineTo(x, y);
              ctx.strokeStyle = lineColor;
              ctx.lineWidth = 0.3;
              ctx.stroke();
            }
            wasPenUp = false; // Pen is now down
        } else { // If current point is blanked
            wasPenUp = true; // Pen is now up
        }
        
        // Always update lastX, lastY to the current point's coordinates
        lastX = x;
        lastY = y;
        pointIndex++;
      }

      animationFrameId.current = requestAnimationFrame(renderSegment);
    };

    renderSegment();

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [frame, showBeamEffect, beamAlpha, fadeAlpha, drawSpeed]); // Add new props to dependencies

  return (
    <div className="ilda-player">
      <h3>Selected Preview</h3>
      <canvas ref={canvasRef} width="250" height="250" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default IldaPlayer;