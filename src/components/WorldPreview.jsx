import React, { useEffect, useRef } from 'react';

const WorldPreview = ({ worldData }) => {
  const canvasRef = useRef(null);
  const frameIndexesRef = useRef([]);

  useEffect(() => {
    // Initialize frame indexes when worldData changes
    frameIndexesRef.current = worldData.map(() => 0);
  }, [worldData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worldData) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    let animationFrameId;

    const render = () => {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);

      worldData.forEach((clip, clipIndex) => {
        if (clip && clip.frames && clip.frames.length > 0) {
          const frameIndex = frameIndexesRef.current[clipIndex] || 0;
          const frame = clip.frames[frameIndex];

          if (frame && frame.points) {
            let lastX = ((0 + 32768) / 65535) * width;
            let lastY = height - (((0 + 32768) / 65535) * height);
            let wasPenUp = true;

            for (let i = 0; i < frame.points.length; i++) {
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

      frameIndexesRef.current = frameIndexesRef.current.map((frameIndex, clipIndex) => {
        const clip = worldData[clipIndex];
        if (clip && clip.frames && clip.frames.length > 0) {
          return (frameIndex + 1) % clip.frames.length;
        }
        return 0;
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
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
