import React, { useState, useEffect } from 'react';
import { generatorDefinitions } from '../utils/generatorDefinitions'; // Import generatorDefinitions

const GeneratorPanel = () => {
  const [ndiSources, setNdiSources] = useState([]);

  useEffect(() => {
    const discoverSources = async () => {
      if (window.electronAPI && window.electronAPI.ndiFindSources) {
        const sources = await window.electronAPI.ndiFindSources();
        setNdiSources(sources || []);
      }
    };

    discoverSources();
    const interval = setInterval(discoverSources, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const handleDragStart = (e, generator) => {
    // Pass the entire generator definition, including defaultParams
    e.dataTransfer.setData('application/json', JSON.stringify(generator));
  };

  const handleNdiDragStart = (e, source) => {
      const ndiGenerator = generatorDefinitions.find(g => g.id === 'ndi-source');
      const generatorInstance = {
          ...ndiGenerator,
          defaultParams: {
              ...ndiGenerator.defaultParams,
              sourceName: source.name
          }
      };
      e.dataTransfer.setData('application/json', JSON.stringify(generatorInstance));
  };

  return (
    <div className="generator-panel">
      <h3>Generators</h3>
      <div className="generator-list">
        {generatorDefinitions.filter(g => g.id !== 'ndi-source' && g.id !== 'spout-receiver').map((generator) => (
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

      <h3 style={{ marginTop: '10px' }}>NDI Sources</h3>
      <div className="generator-list">
        {ndiSources.length > 0 ? (
          ndiSources.map((source, idx) => (
            <div
              key={`${source.name}-${idx}`}
              className="generator-item ndi-item"
              draggable
              onDragStart={(e) => handleNdiDragStart(e, source)}
            >
              {source.name}
            </div>
          ))
        ) : (
          <div className="empty-msg">No NDI sources found</div>
        )}
      </div>
    </div>
  );
};

export default GeneratorPanel;
