import React from 'react';

const generators = [
  { id: 'circle', name: 'circle', params: { radius: 0.5, numPoints: 100 } },
  { id: 'square', name: 'square', params: { width: 0.5, height: 0.5 } },
  { id: 'line', name: 'line', params: { x1: -0.5, y1: 0, x2: 0.5, y2: 0 } },
  { id: 'text', name: 'text', params: { text: 'Hello' } },
  { id: 'star', name: 'star', params: { outerRadius: 0.5, innerRadius: 0.2, numPoints: 5 } },
];

const GeneratorPanel = () => {
  const handleDragStart = (e, generator) => {
    e.dataTransfer.setData('application/json', JSON.stringify(generator));
  };

  return (
    <div className="generator-panel">
      <h3>Generators</h3>
        {generators.map((generator) => (
          <div
            key={generator.id}
            className="generator-item"
            draggable
            onDragStart={(e) => handleDragStart(e, generator)}
          >
            {generator.name}
          </div>
        ))}
    </div>
  );
};

export default GeneratorPanel;
