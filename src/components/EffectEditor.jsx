import React from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';
import SyncControls from './SyncControls';

const EffectEditor = ({ effect, onParamChange, onRemove, syncSettings = {}, onSetParamSync }) => {
  if (!effect) {
    return null;
  }

  const effectDefinition = effectDefinitions.find(def => def.id === effect.id);

  if (!effectDefinition) {
    return (
      <div className="effect-editor settings-card">
        <div className="effect-header settings-card-header">
            <h4>{effect.name}</h4>
            <button className="remove-effect-btn" onClick={onRemove}>×</button>
        </div>
        <p>No definition found for this effect.</p>
      </div>
    );
  }

  const handleParamChange = (paramId, value) => {
    onParamChange(paramId, value);
  };

  return (
    <div className="effect-editor settings-card">
      <div className="effect-header settings-card-header">
          <h4>{effect.name}</h4>
          <button className="remove-effect-btn" onClick={onRemove}>×</button>
      </div>
      <div className="settings-card-content">
        {effectDefinition.paramControls.map(control => {
          // Handle conditional rendering (showIf)
          if (control.showIf) {
            const shouldShow = Object.entries(control.showIf).every(([key, value]) => {
              return effect.params[key] === value;
            });
            if (!shouldShow) return null;
          }

          const paramKey = `${effect.id}.${control.id}`;

          return (
            <div key={control.id} className="param-editor">
              <div className="param-label-row" style={{ display: 'flex', alignItems: 'center' }}>
                <label htmlFor={control.id}>{control.label}</label>
                <SyncControls 
                    paramId={paramKey}
                    currentSyncMode={syncSettings[paramKey]}
                    onSetSyncMode={onSetParamSync}
                />
              </div>
              <div className="control-row">
                {control.type === 'range' && (
                  <>
                    <input
                      type="range"
                      id={control.id}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={effect.params[control.id]}
                      onChange={(e) => handleParamChange(control.id, parseFloat(e.target.value))}
                      className="param-slider"
                    />
                    <input
                      type="number"
                      value={effect.params[control.id]}
                      onChange={(e) => handleParamChange(control.id, parseFloat(e.target.value) || 0)}
                      className="param-number-input"
                      step={control.step}
                    />
                  </>
                )}
                {control.type === 'text' && (
                  <input
                    type="text"
                    id={control.id}
                    value={effect.params[control.id]}
                    onChange={(e) => handleParamChange(control.id, e.target.value)}
                    className="param-text-input"
                  />
                )}
                {control.type === 'checkbox' && (
                  <input
                    type="checkbox"
                    id={control.id}
                    checked={effect.params[control.id]}
                    onChange={(e) => handleParamChange(control.id, e.target.checked)}
                    className="param-checkbox"
                  />
                )}
                {control.type === 'select' && (
                  <select
                    id={control.id}
                    value={effect.params[control.id]}
                    onChange={(e) => handleParamChange(control.id, e.target.value)}
                    className="param-select"
                  >
                    {control.options.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EffectEditor;