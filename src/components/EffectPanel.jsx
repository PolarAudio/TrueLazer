import React from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';

const EffectPanel = () => {
  const handleDragStart = (e, effect) => {
    e.dataTransfer.setData('application/json', JSON.stringify(effect));
  };

  return (
    <div className="effect-panel">
      <h3>Effects</h3>
      {effectDefinitions.map(effect => (
        <div 
          key={effect.id}
          draggable 
          onDragStart={(e) => handleDragStart(e, effect)}
          className="effect-item"
        >
          {effect.name}
        </div>
      ))}
    </div>
  );
};

export default EffectPanel;
