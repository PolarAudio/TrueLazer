import React, { useState, useEffect } from 'react';
import IldaThumbnail from './IldaThumbnail'; // Import IldaThumbnail

const LayerControls = ({ layerName, index, onDropEffect, layerEffects, activeClipData }) => {
  const [appliedEffects, setAppliedEffects] = useState(layerEffects || []);

  // Update internal state when layerEffects prop changes
  useEffect(() => {
    setAppliedEffects(layerEffects || []);
  }, [layerEffects]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    console.log(`Right-clicked LayerControls at index: ${index}`);
    if (window.electronAPI) {
      window.electronAPI.sendContextMenuAction({ type: 'delete-layer', index: index });
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
      <div className="layer-control-row grid-layer">
        <span className="layer-control-button full-height">X</span>
        <div className="layer-control-group">
          <span className="layer-control-button half-height">B</span>
          <span className="layer-control-button half-height">S</span>
        </div>
		<select className="layer-blend-dropdown">
          <option>Normal</option>
          <option>Add</option>
          <option>Subtract</option>
        </select>
      </div>
		<div className="layer-control-row">
			<input type="range" min="0" max="100" defaultValue="100" className="layer-intensity-slider" />
		</div>
		<div className="layer-preview-thumbnail">
			{activeClipData && activeClipData.frames && activeClipData.frames.length > 0 ? (
				<IldaThumbnail frame={activeClipData.frames[0]} /> // Render thumbnail of active clip
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