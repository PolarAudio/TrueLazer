import React, { useState, useEffect, useMemo } from 'react';
import { applyEffects } from '../utils/effects'; // Import the applyEffects function
import IldaThumbnail from './IldaThumbnail';

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
  const displayName = clipContent && clipContent.type === 'generator' && clipContent.generatorDefinition
    ? clipContent.generatorDefinition.name
    : clipName;

  const frameForThumbnail = thumbnailRenderMode === 'active' ? liveFrame : stillFrame;

  // Apply effects to the frame that will be used for the thumbnail
  const effectedFrameForThumbnail = useMemo(() => {
    if (frameForThumbnail && clipContent && clipContent.effects && clipContent.effects.length > 0) {
      return applyEffects(frameForThumbnail, clipContent.effects);
    }
    return frameForThumbnail;
  }, [frameForThumbnail, clipContent]);
  
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
    console.log('[Clip.jsx] handleFileDrop - Processing file:', droppedFileName); // DEBUG LOG
    if (!ildaParserWorker) {
      console.log('[Clip.jsx] handleFileDrop - ILDA parser not available.'); // DEBUG LOG
      onUnsupportedFile("ILDA parser not available.");
      return;
    }

    // Check if it's an ILD file
    if (droppedFileName.toLowerCase().endsWith('.ild')) {
      console.log('[Clip.jsx] handleFileDrop - File is an ILD:', droppedFileName); // DEBUG LOG
      try {
        const arrayBuffer = await file.arrayBuffer();
        console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFileDrop): ${arrayBuffer.byteLength}`);
        ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName: droppedFileName, filePath: file.path, layerIndex, colIndex }, [arrayBuffer]);
        console.log('[Clip.jsx] handleFileDrop - Posted message to ildaParserWorker.'); // DEBUG LOG
      } catch (error) {
        console.error('[Clip.jsx] handleFileDrop - Error reading file:', error);
        onUnsupportedFile(`Error reading file: ${error.message}`);
      }
    } else {
      console.log('[Clip.jsx] handleFileDrop - Unsupported file type:', droppedFileName); // DEBUG LOG
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
        console.log('[Clip.jsx] handleDrop - parsedData:', parsedData); // Existing log
        console.log('Clip.jsx: parsedData *before* calling onDropDac:', parsedData); // New log
        
        // Check if this is file path data from the file system
        if (parsedData.filePath && parsedData.fileName) {
          handleFilePathDrop(parsedData.filePath, parsedData.fileName);
          return; // Important: return after handling file path
        }

        if (parsedData.type === 'transform' || parsedData.type === 'animation' || parsedData.type === 'color') {
          if (onDropEffect) {
            console.log('[Clip.jsx] Calling onDropEffect'); // DEBUG LOG
            onDropEffect(parsedData);
            onLabelClick(); // Select the clip to show its new settings
            return;
          }
        } else if (parsedData.name) {
          if (onDropGenerator) {
            console.log('[Clip.jsx] Calling onDropGenerator with:', parsedData.name); // DEBUG LOG
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
      console.log('[Clip.jsx] handleDrop - Files detected:', files); // DEBUG LOG
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
      window.electronAPI.showClipContextMenu(layerIndex, colIndex);
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
      <div className="clip-thumbnail" onClick={onActivateClick}>
        {clipContent && clipContent.parsing ? (
          <div className="clip-loading-spinner"></div>
        ) : effectedFrameForThumbnail ? (
          <IldaThumbnail frame={effectedFrameForThumbnail} />
        ) : (
          <p></p>
        )}
      </div>
      <span className={`clip-label ${isSelected ? 'selected-clip' : ''}`} onClick={onLabelClick}>{displayName}</span>
    </div>
  );
};

export default Clip;