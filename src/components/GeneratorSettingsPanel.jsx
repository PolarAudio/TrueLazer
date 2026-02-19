import React, { useState, useEffect, useMemo } from 'react';
import { generatorDefinitions } from '../utils/generatorDefinitions';
import CollapsiblePanel from './CollapsiblePanel';
import RangeSlider from './RangeSlider';
import DualRangeSlider from './DualRangeSlider';
import AnimationControls from './AnimationControls';

const GeneratorParameter = ({ control, value, onChange, syncSettings, onSetParamSync, layerIndex, colIndex, progressRef, workerId, generatorId, clipDuration, uiState, onUpdateUiState }) => {
    const [hovered, setHovered] = useState(false);

    const paramKey = `${generatorId}.${control.id}`;
    const expanded = !!uiState?.expandedParams?.[paramKey];

    const setExpanded = (val) => {
        if (onUpdateUiState) {
            onUpdateUiState({
                expandedParams: {
                    ...(uiState?.expandedParams || {}),
                    [paramKey]: val
                }
            });
        }
    };

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
                style={{fontSize: '11px', color: '#aaa', cursor: 'grab'}}
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
                        control.isRange ? (
                            <DualRangeSlider
                                min={control.min}
                                max={control.max}
                                step={control.step}
                                value={value}
                                onChange={(val) => onChange(control.id, val)}
                            />
                        ) : (
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
                        )
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
                    ) : control.type === 'select' ? (
                        <select
                            value={value}
                            onChange={(e) => onChange(control.id, e.target.value)}
                            className="param-select"
                            style={{width: '100%', fontSize: '11px', background: '#333', color: '#fff', border: '1px solid #555'}}
                        >
                            {control.options.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
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

const GeneratorSettingsPanel = ({ selectedGeneratorId, selectedGeneratorParams, onParameterChange, syncSettings = {}, onSetParamSync, layerIndex, colIndex, progressRef, workerId, clipDuration, uiState, onUpdateUiState }) => {
  const [systemFonts, setSystemFonts] = useState([]);
  const [projectFonts, setProjectFonts] = useState([]);
  const [loadingSystemFonts, setLoadingSystemFonts] = useState(false);

  if (!selectedGeneratorId) {
    return <div className="generator-settings-panel">No generator selected.</div>;
  }

  const generatorDefinition = generatorDefinitions.find(def => def.id === selectedGeneratorId);

  if (!generatorDefinition) {
    return <div className="generator-settings-panel">Generator definition not found for ID: {selectedGeneratorId}</div>;
  }

  const collapsedPanels = uiState?.collapsedPanels || {};

  const handleToggle = (val) => {
    if (onUpdateUiState) {
        onUpdateUiState({
            collapsedPanels: {
                ...collapsedPanels,
                generator: val
            }
        });
    }
  };

  // Load project fonts on mount
  useEffect(() => {
    const loadProjectFonts = async () => {
      if (window.electronAPI && window.electronAPI.getProjectFonts) {
        try {
          const fonts = await window.electronAPI.getProjectFonts();
          setProjectFonts(fonts);
        } catch (error) {
          console.error('Failed to load project fonts:', error);
        }
      }
    };
    loadProjectFonts();
  }, []);

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
    } else if (value === 'load-system') {
      setLoadingSystemFonts(true);
      try {
        const fonts = await window.electronAPI.getSystemFonts();
        const fontObjects = fonts.map(f => ({
          name: f.split(/[\\/]/).pop(),
          path: f
        })).sort((a, b) => a.name.localeCompare(b.name));
        setSystemFonts(fontObjects);
      } catch (e) {
        console.error('Failed to load system fonts:', e);
      }
      setLoadingSystemFonts(false);
    } else {
      onParameterChange('fontUrl', value);
    }
  };

  return (
    <CollapsiblePanel 
        title={`${generatorDefinition.name} Settings`}
        isCollapsed={!!collapsedPanels['generator']}
        onToggle={handleToggle}
    >
        {generatorDefinition.paramControls
          .filter(control => {
              if (control.condition && !control.condition(selectedGeneratorParams)) return false;
              if (control.showIf) {
                  return Object.entries(control.showIf).every(([key, value]) => {
                      if (Array.isArray(value)) {
                          return value.includes(selectedGeneratorParams[key]);
                      }
                      return selectedGeneratorParams[key] === value;
                  });
              }
              return true;
          })
          .map(control => {
          // Special case for fontUrl
          if (control.id === 'fontUrl') {
              const currentFont = selectedGeneratorParams[control.id] || 'src/fonts/Geometr415 Blk BT Black.ttf';
              
              return (
                <div key={control.id} className="param-editor">
                    <label className="param-label">{control.label}</label>
                    <div className="font-selector-container">
                        <select 
                            className="param-select"
                            onChange={handleFontChange} 
                            value={currentFont}
                        >
                            {projectFonts.length > 0 ? (
                                <optgroup label="Project Fonts">
                                    {projectFonts.map(f => (
                                        <option key={f.path} value={f.path}>{f.name}</option>
                                    ))}
                                </optgroup>
                            ) : (
                                <optgroup label="Default Fonts">
                                     <option value="src/fonts/Geometr415 Blk BT Black.ttf">Geometr415</option>
                                </optgroup>
                            )}
                            
                            {systemFonts.length > 0 ? (
                                <optgroup label="System Fonts">
                                    {systemFonts.map(f => (
                                        <option key={f.path} value={f.path}>{f.name}</option>
                                    ))}
                                </optgroup>
                            ) : (
                                <option value="load-system">{loadingSystemFonts ? 'Loading...' : 'Load System Fonts...'}</option>
                            )}
                            
                            <optgroup label="Actions">
                                <option value="browse">Browse File...</option>
                            </optgroup>
                        </select>
                        <span className="font-path-tiny" title={currentFont}>{currentFont.split(/[\\/]/).pop()}</span>
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
                uiState={uiState}
                onUpdateUiState={onUpdateUiState}
            />
          );
        })}
    </CollapsiblePanel>
  );
};

export default GeneratorSettingsPanel;