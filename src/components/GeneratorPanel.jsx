import React from 'react';

const generators = [
  { id: 'circle', name: 'Circle' },
  { id: 'square', name: 'Square' },
  { id: 'line', name: 'Line' },
  { id: 'text', name: 'Text' },
];

const GeneratorPanel = () => {
  const handleDragStart = (e, generatorId) => {
    e.dataTransfer.setData('application/x-generator', generatorId);
  };

  return (
    <div className="generator-panel">
      <h3>Generators</h3>
      <div className="generator-list">
        {generators.map((generator) => (
          <div
            key={generator.id}
            className="generator-item"
            draggable
            onDragStart={(e) => handleDragStart(e, generator.id)}
          >
            {generator.name}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GeneratorPanel;
