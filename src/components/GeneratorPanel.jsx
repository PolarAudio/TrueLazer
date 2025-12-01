import React from 'react';
import { generatorDefinitions } from '../utils/generatorDefinitions'; // Import generatorDefinitions

const GeneratorPanel = () => {
  const handleDragStart = (e, generator) => {
    // Pass the entire generator definition, including defaultParams
    e.dataTransfer.setData('application/json', JSON.stringify(generator));
  };

  return (
    <div className="generator-panel">
      <h3>Generators</h3>
        {generatorDefinitions.map((generator) => ( // Use generatorDefinitions
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
