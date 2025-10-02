import React, { useState, useEffect } from 'react';

import IldaThumbnail from './IldaThumbnail';
import { useIldaParserWorker } from '../contexts/IldaParserWorkerContext';

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
  isActive
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const worker = useIldaParserWorker();

  const thumbnailFrame = clipContent && clipContent.frames && clipContent.frames[thumbnailFrameIndex]
    ? clipContent.frames[thumbnailFrameIndex]
    : null;

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

    if (!worker) {
      onUnsupportedFile("ILDA parser not available.");
      return;
    }

    // Check if it's an ILD file
    if (file.name.toLowerCase().endsWith('.ild')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFileDrop): ${arrayBuffer.byteLength}`);
        worker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName: droppedFileName, layerIndex, colIndex }, [arrayBuffer]);
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

  if (!worker) {
    onUnsupportedFile("ILDA parser not available.");
    return;
  }

  try {
    // Use readFileAsBinary instead of readFileContent
    if (window.electronAPI && window.electronAPI.readFileAsBinary) {
      const uint8Array = await window.electronAPI.readFileAsBinary(filePath);
      // Convert Uint8Array to ArrayBuffer - this is much simpler!
      const arrayBuffer = uint8Array.buffer;
      console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFilePathDrop): ${arrayBuffer.byteLength}`);
      worker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName, layerIndex, colIndex }, [arrayBuffer]);
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

    // Check if it's an effect drop (from your EffectPanel)
    const effectData = e.dataTransfer.getData('application/x-laser-effect');
    
    if (effectData) {
      try {
        const parsedEffect = JSON.parse(effectData);
        if (onDropEffect) {
          onDropEffect(parsedEffect);
          return; // Important: return after handling effect
        } else {
          console.error('onDropEffect prop is not defined!');
        }
      } catch (error) {
        console.error('Error parsing effect data:', error);
      }
    }
    
    // Check for file path data (common in Electron apps)
    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const parsedJson = JSON.parse(jsonData);
        
        // Check if this is file path data from the file system
        if (parsedJson.filePath && parsedJson.fileName) {
          handleFilePathDrop(parsedJson.filePath, parsedJson.fileName);
          return; // Important: return after handling file path
        }
      } catch (error) {
        console.error('Error parsing JSON data:', error);
      }
    }
    
    // Check if it's a direct file drop
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileDrop(files[0]);
      return; // Important: return after handling file
    }
    
    console.log('No recognized data format found in drop');
    onUnsupportedFile("No valid ILD file or effect dropped.");
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
      className={`clip ${isDragging ? 'dragging' : ''} ${isActive ? 'active-clip' : ''} ${isSelected ? 'selected-clip' : ''}`}
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
          <p>Drag ILD Here</p>
        )}
      </div>
      <span className="clip-label" onClick={onLabelClick}>{clipName}</span>
    </div>
  );
};

export default Clip;