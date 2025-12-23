import React from 'react';
import { generatorDefinitions } from '../utils/generatorDefinitions';
import SyncControls from './SyncControls';

const GeneratorSettingsPanel = ({ selectedGeneratorId, selectedGeneratorParams, onParameterChange, syncSettings = {}, onSetParamSync }) => {
  if (!selectedGeneratorId) {
    return <div className="generator-settings-panel">No generator selected.</div>;
  }

  const generatorDefinition = generatorDefinitions.find(def => def.id === selectedGeneratorId);

  if (!generatorDefinition) {
    return <div className="generator-settings-panel">Generator definition not found for ID: {selectedGeneratorId}</div>;
  }

  const handleInputChange = (paramId, value) => {
    const paramControl = generatorDefinition.paramControls.find(control => control.id === paramId);
    let processedValue = value;
    if (paramControl && (paramControl.type === 'range' || paramControl.type === 'number')) {
      processedValue = parseFloat(value);
    } else if (paramControl && paramControl.type === 'checkbox') {
      processedValue = value;
    }
    onParameterChange(paramId, processedValue);
  };

  const handleFontChange = async (e) => {
    const value = e.target.value;
    if (value === 'browse') {
      if (window.electronAPI && window.electronAPI.showFontFileDialog) {
        const filePath = await window.electronAPI.showFontFileDialog();
        if (filePath) {
          onParameterChange('fontUrl', filePath);
        }
      } else {
        console.error('Font file dialog API not available.');
      }
    } else {
      onParameterChange('fontUrl', value);
    }
  };

  return (
    <div className="generator-settings-panel settings-card">
      <div className="settings-card-header">
        <h4>{generatorDefinition.name} Settings</h4>
      </div>
      <div className="settings-card-content">
        {generatorDefinition.paramControls.map(control => (
          <div key={control.id} className="param-editor">
            <div className="param-label-row" style={{ display: 'flex', alignItems: 'center' }}>
              <label htmlFor={control.id}>{control.label}</label>
              <SyncControls 
                  paramId={`${selectedGeneratorId}.${control.id}`}
                  currentSyncMode={syncSettings[`${selectedGeneratorId}.${control.id}`]}
                  onSetSyncMode={onSetParamSync}
              />
            </div>
            <div className="control-row">
              {/* Special case for fontUrl */}
              {control.id === 'fontUrl' ? (
                <div className="font-selector-container">
                  <select 
                    className="param-select"
                    onChange={handleFontChange} 
                    value={selectedGeneratorParams[control.id] || 'src/fonts/arial.ttf'}
                  >
                    <option value="src/fonts/arial.ttf">Arial</option>
                    <option value="src/fonts/impact.ttf">Impact</option>
                    <option value="src/fonts/Geometr415 Blk BT Black.ttf">Geometric 415</option>
                    <option value="src/fonts/STENCIL.TTF">Stencil</option>
                    <option value="browse">Browse...</option>
                  </select>
                  <span className="font-path-tiny">{selectedGeneratorParams[control.id]?.split(/[\\/]/).pop()}</span>
                </div>
              ) : control.type === 'range' ? (
                <>
                  <input
                    type="range"
                    id={control.id}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={selectedGeneratorParams[control.id] || ''}
                    onChange={(e) => handleInputChange(control.id, e.target.value)}
                    className="param-slider"
                  />
                  <input
                    type="number"
                    value={selectedGeneratorParams[control.id] || 0}
                    onChange={(e) => handleInputChange(control.id, e.target.value)}
                    className="param-number-input"
                    step={control.step}
                  />
                </>
              ) : control.type === 'number' ? (
                <input
                  type="number"
                  id={control.id}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={selectedGeneratorParams[control.id] || ''}
                  onChange={(e) => handleInputChange(control.id, e.target.value)}
                  className="param-number-input"
                />
              ) : control.type === 'text' ? (
                <input
                  type="text"
                  id={control.id}
                  value={selectedGeneratorParams[control.id] || ''}
                  onChange={(e) => handleInputChange(control.id, e.target.value)}
                  className="param-text-input"
                />
              ) : control.type === 'checkbox' ? (
                <input
                  type="checkbox"
                  id={control.id}
                  checked={selectedGeneratorParams[control.id] || false}
                  onChange={(e) => handleInputChange(control.id, e.target.checked)}
                  className="param-checkbox"
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GeneratorSettingsPanel;