import React, { useEffect, useRef } from 'react';

const WorldPreview = ({ worldData, showBeamEffect, beamAlpha, fadeAlpha, drawSpeed }) => {
  const canvasRef = useRef(null);
  const frameIndexesRef = useRef([]);
  const lastUpdateTime = useRef(0);
  const animationFrameId = useRef(null);

  useEffect(() => {
    // Initialize frame indexes when worldData changes
    frameIndexesRef.current = worldData.map(() => 0);
  }, [worldData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worldData) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    const animate = (currentTime) => {
      if (!lastUpdateTime.current) lastUpdateTime.current = currentTime;
      const deltaTime = currentTime - lastUpdateTime.current;

      // Update frame indexes only if enough time has passed (e.g., 100ms per frame)
      const frameUpdateInterval = 100; // milliseconds per frame
      if (deltaTime >= frameUpdateInterval) {
        frameIndexesRef.current = frameIndexesRef.current.map((frameIndex, clipIndex) => {
          const clip = worldData[clipIndex];
          if (clip && clip.frames && clip.frames.length > 0) {
            return (frameIndex + 1) % clip.frames.length;
          }
          return 0;
        });
        lastUpdateTime.current = currentTime;
      }

      // Apply fading effect
      ctx.globalAlpha = fadeAlpha;
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1; // Reset globalAlpha for drawing content

      worldData.forEach((clip, clipIndex) => {
        if (clip && clip.frames && clip.frames.length > 0) {
          const frameIndex = frameIndexesRef.current[clipIndex] || 0;
          const frame = clip.frames[frameIndex];

          if (frame && frame.points) {
            let lastX = ((0 + 32768) / 65535) * width;
            let lastY = height - (((0 + 32768) / 65535) * height);
            let wasPenUp = true;

            // Use drawSpeed to control how many points are drawn per animation frame
            for (let i = 0; i < frame.points.length; i += Math.max(1, Math.floor(frame.points.length / drawSpeed))) {
              const currentPoint = frame.points[i];
              const x = ((currentPoint.x + 32768) / 65535) * width;
              const y = height - (((currentPoint.y + 32768) / 65535) * height);

              if (!currentPoint.blanking) {
                const lineColor = `rgb(${currentPoint.r}, ${currentPoint.g}, ${currentPoint.b})`;
                if (wasPenUp) {
                  ctx.fillStyle = lineColor;
                  ctx.beginPath();
                  ctx.arc(x, y, 1, 0, Math.PI * 2);
                  ctx.fill();
                } else {
                  // Draw beam effect if enabled
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

                  ctx.beginPath();
                  ctx.moveTo(lastX, lastY);
                  ctx.lineTo(x, y);
                  ctx.strokeStyle = lineColor;
                  ctx.lineWidth = 0.5;
                  ctx.stroke();
                }
                wasPenUp = false;
              } else {
                wasPenUp = true;
              }
              lastX = x;
              lastY = y;
            }
          }
        }
      });

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [worldData]);

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
      <canvas ref={canvasRef} width="250" height="250" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default WorldPreview;
