import React from 'react';
import { generatorDefinitions } from '../utils/generatorDefinitions';

const GeneratorSettingsPanel = ({ selectedGeneratorId, selectedGeneratorParams, onParameterChange }) => {
  if (!selectedGeneratorId) {
    return <div className="generator-settings-panel">No generator selected.</div>;
  }

  const generatorDefinition = generatorDefinitions.find(def => def.id === selectedGeneratorId);

  if (!generatorDefinition) {
    return <div className="generator-settings-panel">Generator definition not found for ID: {selectedGeneratorId}</div>;
  }

  const handleInputChange = (paramId, value) => {
    // Convert numerical inputs from string to number
    const paramControl = generatorDefinition.paramControls.find(control => control.id === paramId);
    let processedValue = value;
    if (paramControl && (paramControl.type === 'range' || paramControl.type === 'number')) {
      processedValue = parseFloat(value);
    } else if (paramControl && paramControl.type === 'checkbox') {
        processedValue = value; // Checkboxes already return boolean
    }
    onParameterChange(paramId, processedValue);
  };

  return (
    <div className="generator-settings-panel">
      <h4>{generatorDefinition.name} Settings</h4>
      {generatorDefinition.paramControls.map(control => (
        <div key={control.id} className="generator-param-control">
          <label htmlFor={control.id}>{control.label}:</label>
          {control.type === 'range' && (
            <>
              <input
                type="range"
                id={control.id}
                min={control.min}
                max={control.max}
                step={control.step}
                value={selectedGeneratorParams[control.id] || ''}
                onChange={(e) => handleInputChange(control.id, e.target.value)}
              />
              <span>{selectedGeneratorParams[control.id]}</span>
            </>
          )}
          {control.type === 'number' && (
            <input
              type="number"
              id={control.id}
              min={control.min}
              max={control.max}
              step={control.step}
              value={selectedGeneratorParams[control.id] || ''}
              onChange={(e) => handleInputChange(control.id, e.target.value)}
            />
          )}
          {control.type === 'text' && (
            <input
              type="text"
              id={control.id}
              value={selectedGeneratorParams[control.id] || ''}
              onChange={(e) => handleInputChange(control.id, e.target.value)}
            />
          )}
          {control.type === 'checkbox' && (
            <input
              type="checkbox"
              id={control.id}
              checked={selectedGeneratorParams[control.id] || false}
              onChange={(e) => handleInputChange(control.id, e.target.checked)}
            />
          )}
          {/* Add more control types as needed */}
        </div>
      ))}
    </div>
  );
};

export default GeneratorSettingsPanel;