import React, { useState } from 'react';
import { parseIldaFile } from '../utils/ilda-parser';
import IldaThumbnail from './IldaThumbnail';

const Clip = ({
  clipName,
  layerIndex,
  colIndex,
  onDropGenerator,
  clipContent,
  thumbnailFrameIndex,
  onUnsupportedFile,
  onActivateClick, 
  onLabelClick,
  isSelected,
  isActive // New prop
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const thumbnailFrame = clipContent && clipContent.frames && clipContent.frames[thumbnailFrameIndex]
    ? clipContent.frames[thumbnailFrameIndex]
    : null;

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    let droppedFileContent = null;
    let droppedFileName = null;

    if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && file.name.toLowerCase().endsWith('.ild')) {
            droppedFileName = file.name;
            const reader = new FileReader();
            droppedFileContent = await new Promise((resolve) => {
              reader.onload = (event) => resolve(event.target.result);
              reader.readAsArrayBuffer(file);
            });
            break;
          }
        } else if (item.kind === 'string' && item.type === 'application/json') {
          const jsonString = await new Promise((resolve) => item.getAsString(resolve));
          try {
            const data = JSON.parse(jsonString);
            if (data.filePath && data.fileName.toLowerCase().endsWith('.ild')) {
              droppedFileName = data.fileName;
              if (window.electronAPI && window.electronAPI.readFileContent) {
                const buffer = await window.electronAPI.readFileContent(data.filePath);
                if (buffer && buffer.buffer instanceof ArrayBuffer) {
                  droppedFileContent = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                } else if (buffer instanceof ArrayBuffer) {
                  droppedFileContent = buffer;
                }
              }
              break;
            }
          } catch (error) {
            console.error("Error parsing dropped JSON data:", error);
          }
        }
      }
    }

    if (!droppedFileContent) {
      onUnsupportedFile("No valid ILD file dropped.");
      return;
    }

    try {
      const parsedData = parseIldaFile(droppedFileContent);
      if (parsedData.error || parsedData.frames.length === 0) {
        onUnsupportedFile(`Error parsing ILDA file: ${parsedData.error || 'No frames found'}`);
        return;
      }
      onDropGenerator(parsedData, droppedFileName);
    } catch (error) {
      onUnsupportedFile(`Error processing file: ${error.message}`);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    console.log(`Right-clicked clip: Layer ${layerIndex}, Column ${colIndex}`); // Add log
    if (window.electronAPI && window.electronAPI.showClipContextMenu) {
      window.electronAPI.showClipContextMenu(layerIndex, colIndex);
    }
  };

  return (
    <div
      className={`clip ${isDragging ? 'dragging' : ''} ${isActive ? 'active-clip' : ''} ${isSelected ? 'selected-clip' : ''}`}
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