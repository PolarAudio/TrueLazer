import React, { useEffect, useRef } from 'react';

const IldaPlayer = ({ ildaFrames, showBeamEffect, beamAlpha, fadeAlpha, drawSpeed, onFrameChange }) => {
  const canvasRef = useRef(null);
  const animationFrameId = useRef(null);
  const lastUpdateTime = useRef(0);
  const currentFrameIndexRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    let pointIndex = 0;
    let lastX = ((0 + 32768) / 65535) * width;
    let lastY = height - (((0 + 32768) / 65535) * height);
    let wasPenUp = true;

    const animate = (currentTime) => {
      // Clear canvas at the beginning of each frame
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);

      if (!ildaFrames || ildaFrames.length === 0) {
        animationFrameId.current = requestAnimationFrame(animate);
        return;
      }

      if (!lastUpdateTime.current) lastUpdateTime.current = currentTime;
      const deltaTime = currentTime - lastUpdateTime.current;

      const frameUpdateInterval = 100; // milliseconds per frame
      if (deltaTime >= frameUpdateInterval) {
        currentFrameIndexRef.current = (currentFrameIndexRef.current + 1) % ildaFrames.length;
        lastUpdateTime.current = currentTime;
        if (onFrameChange) {
          onFrameChange(currentFrameIndexRef.current);
        }
      }

      const frame = ildaFrames[currentFrameIndexRef.current];
      if (!frame || !frame.points) {
        animationFrameId.current = requestAnimationFrame(animate);
        return;
      }

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
            } else {
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

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [ildaFrames, showBeamEffect, beamAlpha, fadeAlpha, drawSpeed, onFrameChange]);

  return (
    <div className="ilda-player">
      <h3>Selected Preview</h3>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default IldaPlayer;
