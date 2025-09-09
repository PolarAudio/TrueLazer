import React, { useState, useEffect } from 'react';

const Clip = ({ clipName, onDropGenerator, generatorId, onDropEffect, clipEffects, onClick, isSelected, dacAssignment }) => {
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

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedData = e.dataTransfer.getData('text/plain');

    try {
      const parsedData = JSON.parse(droppedData);

      if (parsedData.type === 'dac') {
        if (onDropGenerator) { // Assuming onDropGenerator is used for DAC assignment for now
          onDropGenerator(parsedData.dacId + '-' + parsedData.channelId);
        }
      } else if (parsedData.type === 'effect') { // Assuming effects are also JSON now
        if (onDropEffect) {
          onDropEffect(parsedData.effectId);
        }
      } else { // Assume it's a generator (plain string)
        if (onDropGenerator) {
          onDropGenerator(droppedData);
        }
      }
    } catch (error) {
      // Fallback for plain text (generators and old effects)
      if (droppedData.startsWith('effect_')) {
        const effectId = droppedData.replace('effect_', '');
        if (onDropEffect) {
          onDropEffect(effectId);
        }
      } else { // Assume it's a generator
        if (onDropGenerator) {
          onDropGenerator(droppedData);
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
