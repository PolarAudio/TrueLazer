import React, { useState } from 'react';

const EffectPanel = () => {
  // Add default effects if none are provided
  const [effects, setEffects] = useState([
    { id: 1, name: 'Rotate', type: 'transform' },
    { id: 2, name: 'Scale', type: 'transform' },
    { id: 3, name: 'Translate', type: 'transform' },
    { id: 4, name: 'Pulse', type: 'animation' },
    { id: 5, name: 'Blink', type: 'animation' }
  ]);
  const handleDragStart = (e, effect) => {
    if (!effect) {
      console.error('Effect is undefined in drag start');
      return;
    }
    
    e.dataTransfer.setData('application/x-laser-effect', JSON.stringify(effect));
    e.dataTransfer.effectAllowed = 'copy';
    console.log('Drag started with effect:', effect.name);
  };

  return (
    <div className="effect-panel">
      <h3>Effects</h3>
      {effects.map(effect => (
        effect ? ( // Add null check
          <div 
            key={effect.id}
            draggable 
            onDragStart={(e) => handleDragStart(e, effect)}
            className="effect-item"
          >
            {effect.name || 'Unnamed Effect'}
          </div>
        ) : null
      ))}
    </div>
  );
};
export default EffectPanel;
