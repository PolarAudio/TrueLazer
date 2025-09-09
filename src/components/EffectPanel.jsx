import React from 'react';

const effects = [
  { id: 'rotate', name: 'Rotate' },
  { id: 'scale', name: 'Scale' },
  { id: 'transform', name: 'Transform' },
  { id: 'blanking', name: 'Blanking' },
  { id: 'color_palette', name: 'Color Palette' },
];

const EffectPanel = () => {
  const handleDragStart = (e, effectId) => {
    e.dataTransfer.setData('application/x-effect', effectId);
  };

  return (
    <div className="effect-panel">
      <h3>Effects</h3>
      <div className="effect-list">
        {effects.map((effect) => (
          <div
            key={effect.id}
            className="effect-item"
            draggable
            onDragStart={(e) => handleDragStart(e, effect.id)}
          >
            {effect.name}
          </div>
        ))}
      </div>
    </div>
  );
};

export default EffectPanel;
