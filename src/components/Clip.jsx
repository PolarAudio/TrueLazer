import React, { useState, useEffect } from 'react';
import IldaPlayer from './IldaPlayer';
import { parseIldaFile } from '../utils/ilda-parser';

const Clip = ({ clipName, onDropGenerator, onUnsupportedFile, generatorId, onDropEffect, clipEffects, onClick, isSelected, dacAssignment }) => {
  const [currentGenerator, setCurrentGenerator] = useState(generatorId || null);
  const [appliedEffects, setAppliedEffects] = useState(clipEffects || []);
  const [assignedDac, setAssignedDac] = useState(dacAssignment || null);

  // Update internal state when generatorId prop changes
  useEffect(() => {
    setCurrentGenerator(generatorId);
  }, [generatorId]);

  // Update internal state when clipEffects prop changes
  useEffect(() => {
    setAppliedEffects(clipEffects);
  }, [clipEffects]);

  // Update internal state when dacAssignment prop changes
  useEffect(() => {
    setAssignedDac(dacAssignment);
  }, [dacAssignment]);

  const handleDragOver = (e) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'copy'; // Visual feedback
  };

  const handleDrop = async (e) => {
    e.preventDefault();

    // Check if the dropped data is JSON (from FileBrowser for ILDA files)
    if (e.dataTransfer.types.includes('application/json')) {
      const droppedData = e.dataTransfer.getData('application/json');
      try {
        const { filePath, fileName } = JSON.parse(droppedData);

        if (filePath.toLowerCase().endsWith('.ild')) {
          if (window.electronAPI) {
            const fileContent = await window.electronAPI.readFileContent(filePath);
            if (fileContent) {
              const arrayBuffer = fileContent.buffer;
              const parsedData = parseIldaFile(arrayBuffer);

              if (parsedData && parsedData.error) {
                if (onUnsupportedFile) {
                  onUnsupportedFile(parsedData.error);
                }
                return; // Stop processing if file is unsupported
              }
              onDropGenerator(parsedData, fileName);
            }
          }
        }
      } catch (error) {
        console.error('Error parsing JSON dropped data:', error);
        // Fallback or handle error for malformed JSON
      }
    } else if (e.dataTransfer.types.includes('text/plain')) {
      const plainTextData = e.dataTransfer.getData('text/plain');
      try {
        const parsedData = JSON.parse(plainTextData); // Try parsing as JSON for DAC/Effect

        if (parsedData.type === 'dac') {
          if (onDropGenerator) {
            onDropGenerator(parsedData.dacId + '-' + parsedData.channelId);
          }
        } else if (parsedData.type === 'effect') {
          if (onDropEffect) {
            onDropEffect(parsedData.effectId);
          }
        }
      } catch (error) {
        // If not JSON, assume it's a plain generator string
        if (plainTextData.startsWith('effect_')) {
          const effectId = plainTextData.replace('effect_', '');
          if (onDropEffect) {
            onDropEffect(effectId);
          }
        } else {
          if (onDropGenerator) {
            onDropGenerator(plainTextData);
          }
        }
      }
    }
  };

  const handleClick = () => {
    console.log(`Clip clicked: ${clipName}`); // Added console.log
    if (onClick) {
      onClick();
    }
  };

  return (
    <div
      className={`clip ${isSelected ? 'selected-clip' : ''}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <div className="clip-thumbnail">
        {currentGenerator && typeof currentGenerator === 'object' ? (
          <IldaPlayer parsedData={currentGenerator} onUnsupportedFile={onUnsupportedFile} />
        ) : null}
        {assignedDac && (
          <div className="dac-assignment-tag">
            {assignedDac.dacId.toUpperCase()} {assignedDac.channelId.toUpperCase()}
          </div>
        )}
        {appliedEffects.length > 0 && (
          <div className="applied-effects">
            {appliedEffects.map(effect => (
              <span key={effect} className="effect-tag">{effect.substring(0, 3).toUpperCase()}</span>
            ))}
          </div>
        )}
      </div>
      <span className="clip-label">{clipName}</span>
    </div>
  );
};

export default Clip;
