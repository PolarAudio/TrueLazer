import React from 'react';

const EffectEditor = ({ effect, onParamChange }) => {
  if (!effect) {
    return null;
  }

  const handleParamChange = (paramName, value) => {
    onParamChange(effect.id, paramName, value);
  };

  return (
    <div className="effect-editor">
      <h4>{effect.name}</h4>
      {Object.entries(effect.params).map(([paramName, value]) => (
        <div key={paramName} className="param-editor">
          <label>{paramName}</label>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={value}
            onChange={(e) => handleParamChange(paramName, parseFloat(e.target.value))}
          />
        </div>
      ))}
    </div>
  );
};

export default EffectEditor;
