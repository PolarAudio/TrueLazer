import React from 'react';

const effects = [
  { id: 1, name: 'rotate', type: 'transform', params: { angle: 0 } },
  { id: 2, name: 'scale', type: 'transform', params: { scaleX: 1, scaleY: 1 } },
  { id: 3, name: 'translate', type: 'transform', params: { translateX: 0, translateY: 0 } },
  { id: 4, name: 'color', type: 'color', params: { r: 255, g: 255, b: 255 } },
  { id: 5, name: 'wave', type: 'animation', params: { amplitude: 0.1, frequency: 10, speed: 1, direction: 'x' } },
  { id: 6, name: 'pulse', type: 'animation', params: { speed: 1 } },
  { id: 7, name: 'blink', type: 'animation', params: { speed: 1 } },
];

const EffectPanel = () => {
  const handleDragStart = (e, effect) => {
    e.dataTransfer.setData('application/json', JSON.stringify(effect));
  };

  return (
    <div className="effect-panel">
      <h3>Effects</h3>
      {effects.map(effect => (
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
