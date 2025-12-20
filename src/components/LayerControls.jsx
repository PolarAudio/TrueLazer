import React, { useState, useEffect } from 'react';
import IldaThumbnail from './IldaThumbnail'; // Import IldaThumbnail

const LayerControls = ({ layerName, index, onDropEffect, layerEffects, activeClipData, onDeactivateLayerClips, onShowLayerFullContextMenu, thumbnailRenderMode, intensity, onIntensityChange, liveFrame, isBlackout, isSolo, onToggleBlackout, onToggleSolo }) => {
  const [appliedEffects, setAppliedEffects] = useState(layerEffects || []);

  // Update internal state when layerEffects prop changes
  useEffect(() => {
    setAppliedEffects(layerEffects || []);
  }, [layerEffects]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    console.log(`Right-clicked LayerControls at index: ${index}`);
    if (onShowLayerFullContextMenu) {
      onShowLayerFullContextMenu(index);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'copy'; // Visual feedback
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain');

    if (droppedId.startsWith('effect_')) {
      const effectId = droppedId.replace('effect_', '');
      if (onDropEffect) {
        onDropEffect(effectId);
      }
    }
  };

  return (
    <div
      className="layer-controls"
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="grid-layer">
        <span className="layer-control-button full-height" onClick={() => onDeactivateLayerClips(index)}>X</span>
        <div className="layer-control-group">
          <span 
            className="layer-control-button half-height" 
            onClick={onToggleBlackout}
            style={{ backgroundColor: isBlackout ? 'red' : '' }}
          >
            B
          </span>
          <span 
            className="layer-control-button half-height" 
            onClick={onToggleSolo}
            style={{ backgroundColor: isSolo ? 'var(--theme-color)' : '', color: isSolo ? 'black' : '' }}
          >
            S
          </span>
        </div>
		<select className="layer-blend-dropdown">
          <option>Normal</option>
          <option>Add</option>
          <option>Subtract</option>
        </select>
      </div>
		<div className="layer-control-row">
			<input type="range" min="0" max="1" step="0.01" value={intensity} className="slider_ver" id="layer-intensity-slider" onChange={(e) => onIntensityChange(parseFloat(e.target.value))} />
		</div>
		<div className="layer-preview-thumbnail">
			{activeClipData ? (
				<IldaThumbnail frame={thumbnailRenderMode === 'still' ? activeClipData.stillFrame : liveFrame} /> // Render thumbnail of active clip based on mode
			) : (
         // Existing applied effects or placeholder
			appliedEffects.length > 0 && (
            <div className="applied-effects">
              {appliedEffects.map(effect => (
                <span key={effect} className="effect-tag">{effect.substring(0, 3).toUpperCase()}</span>
              ))}
            </div>
          )
        )}
      </div>
      <span className="layer-name-label">{layerName}</span>
    </div>
  );
};

export default LayerControls;