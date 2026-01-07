import React, { useState } from 'react';
import { generatorDefinitions } from '../utils/generatorDefinitions';
import CollapsiblePanel from './CollapsiblePanel';
import RangeSlider from './RangeSlider';
import AnimationControls from './AnimationControls';

const GeneratorParameter = ({ control, value, onChange, syncSettings, onSetParamSync, layerIndex, colIndex, progressRef, workerId, generatorId, clipDuration }) => {
    const [expanded, setExpanded] = useState(false);
    const [hovered, setHovered] = useState(false);

    const handleDragStart = (e) => {
        e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
            type: control.type,
            paramName: control.id,
            targetType: 'generator',
            layerIndex,
            colIndex,
            min: control.min,
            max: control.max,
            step: control.step
        }));
    };

    const paramKey = `${generatorId}.${control.id}`;
    const animSettings = typeof syncSettings[paramKey] === 'object' 
        ? syncSettings[paramKey] 
        : { syncMode: syncSettings[paramKey] };

    const currentRange = animSettings?.range || [control.min, control.max];
    const handleRangeChange = (newRange) => {
        onSetParamSync(paramKey, { ...animSettings, range: newRange });
    };

    return (
        <div 
            className={`param-editor ${expanded ? 'expanded' : ''}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ marginBottom: '8px' }}
        >
            <div className="param-label-row" style={{ display: 'flex', alignItems: 'center' }}>
              <label 
                draggable 
                onDragStart={handleDragStart}
                className="param-label"
                style={{fontSize: '11px', color: '#aaa'}}
              >{control.label}</label>
            </div>

            <div className="control-row" style={{ display: 'grid', gridTemplateColumns: '20px 1fr 50px', gap: '5px', alignItems: 'center' }}>
                {/* Gear Icon */}
                <button 
                    className={`anim-toggle-btn ${expanded ? 'active' : ''}`}
                    style={{ 
                        visibility: (hovered || expanded || animSettings?.syncMode) ? 'visible' : 'hidden', 
                        background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, fontSize: '14px'
                    }}
                    onClick={() => setExpanded(!expanded)}
                    title="Animate"
                >
					⚙
				</button>

                {/* Slider / Input */}
                <div className="control-input-wrapper">
                    {control.type === 'range' ? (
                        <RangeSlider
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={value}
                            rangeValue={currentRange}
                            onChange={(val) => onChange(control.id, val)}
                            onRangeChange={handleRangeChange}
                            showRange={expanded}
                            animSettings={animSettings}
                            progressRef={progressRef}
                            workerId={workerId}
                            clipDuration={clipDuration}
                        />
                    ) : control.type === 'number' ? (
                        <input
                            type="number"
                            value={value}
                            onChange={(e) => onChange(control.id, parseFloat(e.target.value) || 0)}
                            className="param-number-input"
                            step={control.step}
                        />
                    ) : control.type === 'text' ? (
                        <input
                            type="text"
                            value={value}
                            onChange={(e) => onChange(control.id, e.target.value)}
                            className="param-text-input"
                        />
                    ) : control.type === 'checkbox' ? (
                        <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) => onChange(control.id, e.target.checked)}
                            className="param-checkbox"
                        />
                    ) : null}
                </div>

                {/* Value Display */}
                {control.type === 'range' && (
                    <input
                        type="number"
                        value={typeof value === 'number' ? value.toFixed(2) : value}
                        onChange={(e) => onChange(control.id, parseFloat(e.target.value) || 0)}
                        className="param-number-input"
                        step={control.step}
                        style={{width: '100%', fontSize: '10px'}}
                    />
                )}
            </div>

            {/* Animation Settings Submenu */}
            {expanded && control.type === 'range' && (
                <div className="param-anim-settings" style={{ marginTop: '5px', padding: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                    <AnimationControls 
                        animSettings={animSettings} 
                        onChange={(newSettings) => onSetParamSync(paramKey, newSettings)} 
                    />
                </div>
            )}
        </div>
    );
};

const GeneratorSettingsPanel = ({ selectedGeneratorId, selectedGeneratorParams, onParameterChange, syncSettings = {}, onSetParamSync, layerIndex, colIndex, progressRef, workerId, clipDuration }) => {
  if (!selectedGeneratorId) {
    return <div className="generator-settings-panel">No generator selected.</div>;
  }

  const generatorDefinition = generatorDefinitions.find(def => def.id === selectedGeneratorId);

  if (!generatorDefinition) {
    return <div className="generator-settings-panel">Generator definition not found for ID: {selectedGeneratorId}</div>;
  }

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
    <CollapsiblePanel title={`${generatorDefinition.name} Settings`}>
        {generatorDefinition.paramControls.map(control => {
          // Special case for fontUrl
          if (control.id === 'fontUrl') {
              return (
                <div key={control.id} className="param-editor">
                    <label className="param-label">{control.label}</label>
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
                </div>
              );
          }

          return (
            <GeneratorParameter
                key={control.id}
                control={control}
                value={selectedGeneratorParams[control.id]}
                onChange={onParameterChange}
                syncSettings={syncSettings}
                onSetParamSync={onSetParamSync}
                layerIndex={layerIndex}
                colIndex={colIndex}
                progressRef={progressRef}
                workerId={workerId}
                generatorId={selectedGeneratorId}
                clipDuration={clipDuration}
            />
          );
        })}
    </CollapsiblePanel>
  );
};

export default GeneratorSettingsPanel;