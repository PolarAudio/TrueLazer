import React, { useState, useEffect, useMemo } from 'react';
import IldaThumbnail from './IldaThumbnail';
import Mappable from './Mappable';

const Clip = ({
  clipName,
  layerIndex,
  colIndex,
  onDropGenerator,
  onDropEffect,
  clipContent,
  thumbnailFrameIndex,
  onUnsupportedFile,
  onActivateClick, 
  onLabelClick,
  isSelected,
  isActive,
  ildaParserWorker,
  onDropDac, // New prop for handling DAC drops
  thumbnailRenderMode,
  liveFrame,
  stillFrame
}) => {
  const [isDragging, setIsDragging] = useState(false);

  // Determine the display name for the clip
  const displayName = clipName;

  const frameForThumbnail = thumbnailRenderMode === 'active' ? liveFrame : stillFrame;
  
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleFileDrop = async (file) => {
    const droppedFileName = file.name;
    if (!ildaParserWorker) {
      onUnsupportedFile("ILDA parser not available.");
      return;
    }

    // Check if it's an ILD file
    if (droppedFileName.toLowerCase().endsWith('.ild')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFileDrop): ${arrayBuffer.byteLength}`);
        ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName: droppedFileName, filePath: file.path, layerIndex, colIndex }, [arrayBuffer]);
      } catch (error) {
        console.error('[Clip.jsx] handleFileDrop - Error reading file:', error);
        onUnsupportedFile(`Error reading file: ${error.message}`);
      }
    } else {
      onUnsupportedFile("Please drop a valid .ild file");
    }
  };

// Updated function to use your existing readFileContent API
const handleFilePathDrop = async (filePath, fileName) => {
  
  if (!fileName.toLowerCase().endsWith('.ild')) {
    console.log('Unsupported file type:', fileName);
    onUnsupportedFile("Please drop a valid .ild file");
    return;
  }

  if (!ildaParserWorker) {
    onUnsupportedFile("ILDA parser not available.");
    return;
  }

  try {
    // Use readFileAsBinary instead of readFileContent
    if (window.electronAPI && window.electronAPI.readFileAsBinary) {
      const uint8Array = await window.electronAPI.readFileAsBinary(filePath);
      // Convert Uint8Array to ArrayBuffer - this is much simpler!
      const arrayBuffer = uint8Array.slice().buffer;
      console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFilePathDrop): ${arrayBuffer.byteLength}`);
      ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName, filePath, layerIndex, colIndex }, [arrayBuffer]);
    } else {
      onUnsupportedFile("Binary file access not available");
    }
  } catch (error) {
    console.error('Error processing file path:', error);
    console.error('Error stack:', error.stack);
    onUnsupportedFile(`Error processing file: ${error.message}`);
  }
};

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const effectData = e.dataTransfer.getData('application/json');
    if (effectData) {
      try {
        const parsedData = JSON.parse(effectData);
        
        // Check if this is file path data from the file system
        if (parsedData.filePath && parsedData.fileName) {
          handleFilePathDrop(parsedData.filePath, parsedData.fileName);
          return; // Important: return after handling file path
        }

        if (parsedData.type === 'transform' || parsedData.type === 'animation' || parsedData.type === 'color' || parsedData.type === 'effect') {
          if (onDropEffect) {
            onDropEffect(parsedData);
            onLabelClick(); // Select the clip to show its new settings
            return;
          }
        } else if (parsedData.name) {
          if (onDropGenerator) {
            onDropGenerator(layerIndex, colIndex, parsedData);
            return;
          }
        } else if (parsedData.ip && typeof parsedData.channel === 'number') { // Check if this is DAC data
          if (onDropDac) {
            onDropDac(layerIndex, colIndex, parsedData);
            return;
          }
        }
      } catch (error) {
        console.error('Error parsing dropped data:', error);
      }
    }
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileDrop(files[0]);
      return;
    }
    
    console.log('No recognized data format found in drop');
    onUnsupportedFile("No valid ILD file, effect, or generator dropped.");
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.showClipContextMenu) {
      window.electronAPI.showClipContextMenu(layerIndex, colIndex, clipContent?.triggerStyle || 'normal');
    }
  };

  return (
    <div
      className={`clip ${isDragging ? 'dragging' : ''} ${isActive ? 'active-clip' : ''} `}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      <Mappable id={`clip_${layerIndex}_${colIndex}`}>
        <div 
            className="clip-thumbnail" 
            onMouseDown={() => onActivateClick(true)}
            onMouseUp={() => onActivateClick(false)}
            onMouseLeave={() => onActivateClick(false)}
            style={{ overflow: 'hidden' }} // Ensure image fits
        >
            {clipContent && clipContent.parsing ? (
                <div className="clip-loading-spinner"></div>
            ) : (
                <>
                    {/* Render Mode Logic */}
                    {thumbnailRenderMode === 'active' ? (
                        /* Live Render Mode: Use liveFrame (or stillFrame if not playing/available) with IldaThumbnail */
                        <IldaThumbnail frame={liveFrame || stillFrame} effects={clipContent?.effects} />
                    ) : (
                        /* Still Frame Mode */
                        /* If we have a generated thumbnail path, use it for efficiency */
                        (clipContent?.thumbnailPath && !isActive) ? (
                            <img 
                                src={`file://${clipContent.thumbnailPath}?t=${Date.now()}`} // Add timestamp to force reload if updated
                                alt="thumbnail" 
                                style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} 
                            />
                        ) : (
                            /* Fallback to WebGL rendering of still frame if no image yet, or if we want to show it */
                            frameForThumbnail && <IldaThumbnail frame={frameForThumbnail} effects={clipContent?.effects} />
                        )
                    )}

                    {clipContent?.triggerStyle && clipContent.triggerStyle !== 'normal' && (
                        <p className="clip_icons">
                            {clipContent.triggerStyle === 'toggle' && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-toggles" viewBox="0 0 16 16">
                                    <path d="M4.5 9a3.5 3.5 0 1 0 0 7h7a3.5 3.5 0 1 0 0-7zm7 6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5m-7-14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5m2.45 0A3.5 3.5 0 0 1 8 3.5 3.5 3.5 0 0 1 6.95 6h4.55a2.5 2.5 0 0 0 0-5zM4.5 0h7a3.5 3.5 0 1 1 0 7h-7a3.5 3.5 0 1 1 0-7"/>
                                </svg>
                            )}
                            {clipContent.triggerStyle === 'flash' && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-lightning-fill" viewBox="0 0 16 16">
                                    <path d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9.5H3.5a.5.5 0 0 1-.48-.641z"/>
                                </svg>
                            )}
                        </p>
                    )}
                </>
            )}
        </div>
      </Mappable>
      <Mappable id={`clip_${layerIndex}_${colIndex}_preview`}>
        <span className={`clip-label ${isSelected ? 'selected-clip' : ''}`} onClick={onLabelClick}>{displayName}</span>
      </Mappable>
    </div>
  );
};

export default React.memo(Clip);