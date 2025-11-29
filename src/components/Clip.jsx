import React, { useState, useEffect } from 'react';

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
  const [thumbnailFrame, setThumbnailFrame] = useState(null); // New state for thumbnail frame

  // Determine the display name for the clip
  const displayName = clipContent && clipContent.type === 'generator' && clipContent.generatorDefinition
    ? clipContent.generatorDefinition.name
    : clipName;

  useEffect(() => {
    if (thumbnailRenderMode === 'still') {
      setThumbnailFrame(stillFrame);
    } else { // 'active' mode
      setThumbnailFrame(liveFrame);
    }
  }, [thumbnailRenderMode, liveFrame, stillFrame]);

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
    if (file.name.toLowerCase().endsWith('.ild')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFileDrop): ${arrayBuffer.byteLength}`);
        ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName: droppedFileName, layerIndex, colIndex }, [arrayBuffer]);
      } catch (error) {
        console.error('Error reading file:', error);
        onUnsupportedFile(`Error reading file: ${error.message}`);
      }
    } else {
      console.log('Unsupported file type:', file.name);
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
      ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName, layerIndex, colIndex }, [arrayBuffer]);
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

        if (parsedData.type === 'transform' || parsedData.type === 'animation' || parsedData.type === 'color') {
          if (onDropEffect) {
            onDropEffect(parsedData);
            return;
          }
        } else if (parsedData.name) {
          if (onDropGenerator) {
            onDropGenerator(layerIndex, colIndex, parsedData);
            return;
          }
        } else if (parsedData.ip && parsedData.channel) { // Check if this is DAC data
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
        {thumbnailFrame ? (
          <IldaThumbnail frame={thumbnailFrame} />
        ) : (
          <p></p>
        )}
      </div>
      <span className={`clip-label ${isSelected ? 'selected-clip' : ''}`} onClick={onLabelClick}>{displayName}</span>
    </div>
  );
};

export default Clip;