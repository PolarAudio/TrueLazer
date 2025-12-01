import React from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';

const EffectEditor = ({ effect, onParamChange }) => {
  if (!effect) {
    return null;
  }

  const effectDefinition = effectDefinitions.find(def => def.id === effect.id);

  if (!effectDefinition) {
    return (
      <div className="effect-editor">
        <h4>{effect.name}</h4>
        <p>No definition found for this effect.</p>
      </div>
    );
  }

  const handleParamChange = (paramId, value) => {
    onParamChange(effect.id, paramId, value);
  };

  return (
    <div className="effect-editor">
      <h4>{effect.name}</h4>
      {effectDefinition.paramControls.map(control => (
        <div key={control.id} className="param-editor">
          <label htmlFor={control.id}>{control.label}</label>
          {control.type === 'range' && (
            <input
              type="range"
              id={control.id}
              min={control.min}
              max={control.max}
              step={control.step}
              value={effect.params[control.id]}
              onChange={(e) => handleParamChange(control.id, parseFloat(e.target.value))}
            />
          )}
          {control.type === 'text' && (
            <input
              type="text"
              id={control.id}
              value={effect.params[control.id]}
              onChange={(e) => handleParamChange(control.id, e.target.value)}
            />
          )}
          {control.type === 'checkbox' && (
            <input
              type="checkbox"
              id={control.id}
              checked={effect.params[control.id]}
              onChange={(e) => handleParamChange(control.id, e.target.checked)}
            />
          )}
          {control.type === 'select' && (
            <select
              id={control.id}
              value={effect.params[control.id]}
              onChange={(e) => handleParamChange(control.id, e.target.value)}
            >
              {control.options.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
};

export default EffectEditor;
