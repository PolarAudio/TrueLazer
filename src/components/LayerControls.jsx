import React, { useState, useEffect, useMemo } from 'react';
import IldaThumbnail from './IldaThumbnail';
import StaticIldaThumbnail from './StaticIldaThumbnail';
import Mappable from './Mappable';

const LayerControls = ({ layerName, index, onDropEffect, onDropDac, layerEffects, activeClipData, onDeactivateLayerClips, onShowLayerFullContextMenu, thumbnailRenderMode, intensity, onIntensityChange, liveFrame, isBlackout, isSolo, onToggleBlackout, onToggleSolo, onLayerSelect }) => {
  const [appliedEffects, setAppliedEffects] = useState(layerEffects || []);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Update internal state when layerEffects prop changes
  useEffect(() => {
    setAppliedEffects(layerEffects || []);
  }, [layerEffects]);

  const combinedEffects = useMemo(() => {
      return [...(activeClipData?.effects || []), ...(layerEffects || [])];
  }, [activeClipData?.effects, layerEffects]);

  const handleDragStart = (e, type, paramName, targetType, label) => {
    e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
        type,
        paramName,
        targetType, 
        layerIndex: index,
        label
    }));
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    console.log(`Right-clicked LayerControls at index: ${index}`);
    if (onShowLayerFullContextMenu) {
      onShowLayerFullContextMenu(index);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // Necessary to allow dropping
    e.stopPropagation();
    setIsDragging(true);
    e.dataTransfer.dropEffect = 'copy'; // Visual feedback
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const parsedData = JSON.parse(jsonData);
        
        if (parsedData.type === 'transform' || parsedData.type === 'animation' || parsedData.type === 'color' || parsedData.type === 'effect') {
          if (onDropEffect) {
            onDropEffect(parsedData.id || parsedData.name);
            return;
          }
        } else if (parsedData.isGroup || (parsedData.ip && (typeof parsedData.channel === 'number' || parsedData.allChannels))) {
          if (onDropDac) {
            onDropDac(index, parsedData);
            return;
          }
        }
      } catch (err) {
        console.error('Error parsing drop data in LayerControls:', err);
      }
    }

    // Fallback for old plain text format
    const droppedId = e.dataTransfer.getData('text/plain');
    if (droppedId.startsWith('effect_')) {
      const effectId = droppedId.replace('effect_', '');
      if (onDropEffect) {
        onDropEffect(effectId);
      }
    }
  };

  // Determine rendering logic based on mode
  const shouldShowLive = (thumbnailRenderMode === 'active') || (thumbnailRenderMode === 'hover' && isHovered);

  return (
    <div
      className={`layer-controls ${isDragging ? 'dragging' : ''}`}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="grid-layer">
        <Mappable id={`layer_${index}_clear`}>
            <span 
                className="layer-control-button full-height" 
                onClick={() => onDeactivateLayerClips(index)}
                draggable
                onDragStart={(e) => handleDragStart(e, 'toggle', 'clear', 'layer', `L${index+1} Clear`)}
            >
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-x-lg" viewBox="0 0 16 16">
					<path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
				</svg>
			</span>
        </Mappable>
        <div className="layer-control-group">
          <Mappable id={`layer_${index}_blackout`}>
            <span 
                className="layer-control-button half-height" 
                onClick={onToggleBlackout}
                style={{ backgroundColor: isBlackout ? 'red' : '' }}
                draggable
                onDragStart={(e) => handleDragStart(e, 'toggle', 'blackout', 'layer', `L${index+1} Blackout`)}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-eye-slash-fill" viewBox="0 0 16 16">
					<path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7 7 0 0 0 2.79-.588M5.21 3.088A7 7 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474z"/>
					<path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171 6-12-12 .708-.708 12 12z"/>
				</svg>
            </span>
          </Mappable>
          <Mappable id={`layer_${index}_solo`}>
            <span 
                className="layer-control-button half-height" 
                onClick={onToggleSolo}
                style={{ backgroundColor: isSolo ? 'var(--theme-color)' : '', color: isSolo ? 'black' : '' }}
                draggable
                onDragStart={(e) => handleDragStart(e, 'toggle', 'solo', 'layer', `L${index+1} Solo`)}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-1-square" viewBox="0 0 16 16">
					<path d="M9.283 4.002V12H7.971V5.338h-.065L6.072 6.656V5.385l1.899-1.383z"/>
					<path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 0a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z"/>
				</svg>
            </span>
          </Mappable>
        </div>
		<select className="layer-blend-dropdown">
          <option>Normal</option>
          <option>Add</option>
          <option>Subtract</option>
        </select>
      </div>
		<div className="layer-control-row">
          <Mappable id={`layer_${index}_intensity`}>
			<input type="range" min="0" max="1" step="0.01" value={intensity} className="slider_ver" id="layer-intensity-slider" onChange={(e) => onIntensityChange(parseFloat(e.target.value))} />
          </Mappable>
		</div>
		<div 
            className="layer-preview-thumbnail"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ overflow: 'hidden' }}
        >
			{activeClipData ? (
                shouldShowLive ? (
                    <IldaThumbnail frame={liveFrame || activeClipData.stillFrame} effects={combinedEffects} />
                ) : (
                    activeClipData.thumbnailPath ? (
                        <img 
                            src={`file://${activeClipData.thumbnailPath}?t=${activeClipData.thumbnailVersion || Date.now()}`}
                            alt="layer-thumbnail"
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                    ) : (
                        <StaticIldaThumbnail frame={activeClipData.stillFrame} />
                    )
                )
			) : (
			appliedEffects.length > 0 && (
            <div className="applied-effects">
              {appliedEffects.map((effect, idx) => (
                <span key={effect.instanceId || idx} className="effect-tag">{(effect.name || effect.id || '???').substring(0, 3).toUpperCase()}</span>
              ))}
            </div>
          )
        )}
      </div>
      <span className="layer-name-label" onClick={() => onLayerSelect && onLayerSelect(index)}>{layerName}</span>
    </div>
  );
};

export default LayerControls;