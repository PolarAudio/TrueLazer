import React, { useEffect, useRef, useState } from 'react';
import { useWorker } from '../contexts/WorkerContext';

const WorldPreview = ({ activeFrames, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, layerIntensities, masterIntensity, dacSettings, previewTime = 0, onToggleBeamEffect, onCycleDisplayMode }) => {
  const canvasRef = useRef(null);
  const worker = useWorker();
  const canvasId = useRef(`world-preview-${Math.random()}`);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worker) return;

    const offscreen = canvas.transferControlToOffscreen();
    
    worker.postMessage({
      action: 'register',
      payload: {
        id: canvasId.current,
        canvas: offscreen,
        type: 'world',
        data: { showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, previewTime }
      }
    }, [offscreen]);

    return () => {
      worker.postMessage({ action: 'deregister', payload: { id: canvasId.current } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!worker) return;

    const transformedWorldData = Object.entries(activeFrames).map(([workerId, { frame, effects, layerIndex, syncSettings, bpm, clipDuration, progress }]) => ({
      frames: [frame],
      effects: effects,
      workerId: workerId,
      layerIndex,
      syncSettings,
      bpm,
      clipDuration,
      progress // Pass progress
    }));

    worker.postMessage({
      action: 'update',
      payload: {
        id: canvasId.current,
        data: { worldData: transformedWorldData, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, layerIntensities, masterIntensity, dacSettings, previewTime }
      }
    });
  }, [worker, activeFrames, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, layerIntensities, masterIntensity, dacSettings, previewTime]);

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
	  <div className="renderSettingToggle">
            <button onClick={onToggleBeamEffect} title="Toggle 2D/3D (Beam Effect)" style={{background:'transparent', border:'none', cursor:'pointer', color:'#aaa'}}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-badge-3d" viewBox="0 0 16 16">
					<path d="M4.52 8.368h.664c.646 0 1.055.378 1.06.9.008.537-.427.919-1.086.919-.598-.004-1.037-.325-1.068-.756H3c.03.914.791 1.688 2.153 1.688 1.24 0 2.285-.66 2.272-1.798-.013-.953-.747-1.38-1.292-1.432v-.062c.44-.07 1.125-.527 1.108-1.375-.013-.906-.8-1.57-2.053-1.565-1.31.005-2.043.734-2.074 1.67h1.103c.022-.391.383-.751.936-.751.532 0 .928.33.928.813.004.479-.383.835-.928.835h-.632v.914zm3.606-3.367V11h2.189C12.125 11 13 9.893 13 7.985c0-1.894-.861-2.984-2.685-2.984zm1.187.967h.844c1.112 0 1.621.686 1.621 2.04 0 1.353-.505 2.02-1.621 2.02h-.844z"/>
					<path d="M14 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
				</svg>
            </button>
            <button onClick={onCycleDisplayMode} title="Cycle Display Mode (Points/Lines)" style={{background:'transparent', border:'none', cursor:'pointer', color:'#aaa'}}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-three-dots" viewBox="0 0 16 16">
                    <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"/>
                </svg>
            </button>
        </div>
      <canvas ref={canvasRef} width="300" height="300" style={{ backgroundColor: 'black' }} />
    </div>
  );
};

export default WorldPreview;