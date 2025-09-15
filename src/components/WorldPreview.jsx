import React, { useEffect, useRef } from 'react';

const WorldPreview = ({ worldData, showBeamEffect, beamAlpha, fadeAlpha, drawSpeed }) => {
  const canvasRef = useRef(null);
  const animationFrameId = useRef(null);
  const lastUpdateTime = useRef(0);
  const frameIndexesRef = useRef([]);
  const pointIndexesRef = useRef([]); // New ref for point indexes per clip
  const worldDataRef = useRef(worldData); // Ref to hold the latest worldData

  // Effect to keep worldDataRef updated without re-running the animation loop
  useEffect(() => {
    const oldWorldData = worldDataRef.current;
    worldDataRef.current = worldData;

    // Preserve frame and point indexes for clips that are still present
    const newFrameIndexes = [];
    const newPointIndexes = [];

    worldData.forEach((newClip, newClipIndex) => {
      const oldClipIndex = oldWorldData.findIndex(oldClip => oldClip === newClip); // Assuming clip objects are stable references
      if (oldClipIndex !== -1) {
        newFrameIndexes[newClipIndex] = frameIndexesRef.current[oldClipIndex] || 0;
        newPointIndexes[newClipIndex] = pointIndexesRef.current[oldClipIndex] || 0;
      } else {
        newFrameIndexes[newClipIndex] = 0;
        newPointIndexes[newClipIndex] = 0;
      }
    });

    frameIndexesRef.current = newFrameIndexes;
    pointIndexesRef.current = newPointIndexes;

  }, [worldData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    const animate = (currentTime) => {
      // Access worldData from the ref
      const currentWorldData = worldDataRef.current;

      if (!currentWorldData || currentWorldData.length === 0) {
        // Clear canvas if no data
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        animationFrameId.current = requestAnimationFrame(animate);
        return;
      }

      if (!lastUpdateTime.current) lastUpdateTime.current = currentTime;
      const deltaTime = currentTime - lastUpdateTime.current;

      const frameUpdateInterval = 100; // milliseconds per frame
      if (deltaTime >= frameUpdateInterval) {
        frameIndexesRef.current = frameIndexesRef.current.map((frameIndex, clipIndex) => {
          const clip = currentWorldData[clipIndex]; // Use currentWorldData
          if (clip && clip.frames && clip.frames.length > 0) {
            return (frameIndex + 1) % clip.frames.length;
          }
          return 0;
        });
        lastUpdateTime.current = currentTime;
      }

      // Clear canvas at the beginning of each frame
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);

      currentWorldData.forEach((clip, clipIndex) => { // Use currentWorldData
        if (clip && clip.frames && clip.frames.length > 0) {
          const frameIndex = frameIndexesRef.current[clipIndex] || 0;
          const frame = clip.frames[frameIndex];

          if (frame && frame.points) {
            let lastX = ((0 + 32768) / 65535) * width;
            let lastY = height - (((0 + 32768) / 65535) * height);
            let wasPenUp = true;
            let currentPointIndex = pointIndexesRef.current[clipIndex];

            for (let i = 0; i < drawSpeed; i++) { // Use drawSpeed
              if (currentPointIndex >= frame.points.length) {
                currentPointIndex = 0; // Loop the frame animation
                lastX = ((0 + 32768) / 65535) * width;
                lastY = height - (((0 + 32768) / 65535) * height);
                wasPenUp = true;
              }

              const currentPoint = frame.points[currentPointIndex];
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
              currentPointIndex++;
            }
            pointIndexesRef.current[clipIndex] = currentPointIndex; // Update the ref
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
  }, [canvasRef, showBeamEffect, beamAlpha, fadeAlpha, drawSpeed]); // Empty dependency array for continuous loop

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
      <canvas ref={canvasRef} width="250" height="250" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default WorldPreview;