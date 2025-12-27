import React, { useRef, useEffect, useState } from 'react';
import { WebGLRenderer } from '../utils/WebGLRenderer';
import { applyEffects } from '../utils/effects';

const IldaThumbnail = ({ frame, effects, width = 100, height = 100 }) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [processedFrame, setProcessedFrame] = useState(null);

  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
        rendererRef.current = new WebGLRenderer(canvasRef.current, 'single');
    }
    
    // Cleanup on unmount
    return () => {
        if (rendererRef.current) {
            // rendererRef.current.destroy(); // If destroy method exists
            rendererRef.current = null;
        }
    };
  }, []);

  useEffect(() => {
    if (!frame) {
        setProcessedFrame(null);
        return;
    }

    let currentFrame = frame;
    if (effects && effects.length > 0) {
        const pts = frame.points;
        const isTyped = frame.isTypedArray || pts instanceof Float32Array;
        
        let newPoints;
        if (isTyped) {
            newPoints = new Float32Array(pts);
        } else {
            newPoints = pts.map(p => ({...p}));
        }
        
        const cloneFrame = { ...frame, points: newPoints, isTypedArray: isTyped };
        currentFrame = applyEffects(cloneFrame, effects, { time: performance.now(), progress: 0, effectStates: new Map() });
    }
    
    setProcessedFrame(currentFrame);

  }, [frame, effects]);

  useEffect(() => {
      if (rendererRef.current && processedFrame) {
          rendererRef.current.render({
              ildaFrames: [processedFrame],
              previewScanRate: 1,
              intensity: 1,
              effects: [], // Effects already applied
              syncSettings: {}
          });
      } else if (rendererRef.current) {
          rendererRef.current.clearCanvas();
      }
  }, [processedFrame]);

  return (
    <div className="clip-thumbnail" style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'black' }}>
        <canvas 
            ref={canvasRef} 
            width={width} 
            height={height} 
            style={{ width: '100%', height: '100%', backgroundColor: 'black' }}
        />
    </div>
  );
};

export default IldaThumbnail;