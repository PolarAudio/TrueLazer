import React, { useState } from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';
import Mappable from './Mappable';
import RangeSlider from './RangeSlider';

const AnimationControls = ({ animSettings, onChange, controlDef }) => {
    const { 
        range = [controlDef.min, controlDef.max], 
        direction = 'forward', 
        style = 'loop', 
        syncMode = null 
    } = animSettings || {};

    const update = (key, val) => onChange({ ...animSettings, [key]: val });

    return (
        <div className="animation-controls-grid">
            {/* Row 1: Range */}
            <div className="anim-row range-row" style={{ width: '100%', marginBottom: '5px' }}>
                <RangeSlider 
                    min={controlDef.min} 
                    max={controlDef.max} 
                    step={controlDef.step} 
                    value={range}
                    onChange={(newRange) => update('range', newRange)}
                />
            </div>
            {/* Row 2: Direction, Style, Sync */}
            <div className="anim-row controls-row">
                <div className="btn-group">
                    <button className={direction === 'backward' ? 'active' : ''} onClick={() => update('direction', 'backward')}>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-caret-left-fill" viewBox="0 0 16 16">
							<path d="m3.86 8.753 5.482 4.796c.646.566 1.658.106 1.658-.753V3.204a1 1 0 0 0-1.659-.753l-5.48 4.796a1 1 0 0 0 0 1.506z"/>
						</svg>
					</button>
                    <button className={direction === 'pause' ? 'active' : ''} onClick={() => update('direction', 'pause')}>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-pause-fill" viewBox="0 0 16 16">
							<path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
						</svg>
					</button>
                    <button className={direction === 'forward' ? 'active' : ''} onClick={() => update('direction', 'forward')}>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-caret-right-fill" viewBox="0 0 16 16">
							<path d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"/>
						</svg>
					</button>
                </div>
                <div className="btn-group">
                    <button className={style === 'once' ? 'active' : ''} onClick={() => update('style', 'once')}>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-repeat-1" viewBox="0 0 16 16">
							<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/>
							<path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>
						</svg>
					</button>
                    <button className={style === 'bounce' ? 'active' : ''} onClick={() => update('style', 'bounce')}>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-left-right" viewBox="0 0 16 16">
							<path fillRule="evenodd" d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5m14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5"/>
						</svg>
					</button>
                    <button className={style === 'loop' ? 'active' : ''} onClick={() => update('style', 'loop')}>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-repeat" viewBox="0 0 16 16">
							<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>
						</svg>
					</button>
                </div>
                <div className="btn-group">
                    <button className={syncMode === 'fps' ? 'active' : ''} onClick={() => update('syncMode', syncMode === 'fps' ? null : 'fps')}>F</button>
                    <button className={syncMode === 'timeline' ? 'active' : ''} onClick={() => update('syncMode', syncMode === 'timeline' ? null : 'timeline')}>T</button>
                    <button className={syncMode === 'bpm' ? 'active' : ''} onClick={() => update('syncMode', syncMode === 'bpm' ? null : 'bpm')}>B</button>
                </div>
            </div>
        </div>
    );
};

const EffectParameter = ({ control, value, onChange, animSettings, onAnimChange, effectId }) => {
    const [expanded, setExpanded] = useState(false);

    const handleDragStart = (e) => {
        e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
            type: control.type,
            paramId: control.id,
            effectId: effectId,
            // We need full path info, but effectId is just 'type'. 
            // Ideally we need instance info, but EffectEditor might not have it cleanly.
            // For now, passing minimal info.
        }));
    };

    return (
        <div className="param-editor">
             <div className="param-header">
                <button 
                    className={`anim-toggle-btn ${expanded ? 'active' : ''}`}
                    onClick={() => setExpanded(!expanded)}
                    title="Animate"
                >
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-gear-fill" viewBox="0 0 16 16">
						<path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
					</svg>
				</button>
                <label className="param-label" draggable onDragStart={handleDragStart}>{control.label}</label>
             </div>

             <div className="control-row">
                {control.type === 'range' && (
                  <>
                    <Mappable id={`${effectId}_${control.id}`}>
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={value}
                      onChange={(e) => onChange(parseFloat(e.target.value))}
                      className="param-slider"
                    />
                    </Mappable>
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                      className="param-number-input"
                      step={control.step}
                    />
                  </>
                )}
                {control.type === 'text' && (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="param-text-input"
                  />
                )}
                {control.type === 'checkbox' && (
                   <Mappable id={`${effectId}_${control.id}`}>
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => onChange(e.target.checked)}
                    className="param-checkbox"
                  />
                  </Mappable>
                )}
                {control.type === 'select' && (
                  <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="param-select"
                  >
                    {control.options.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                )}
             </div>

             {expanded && (
                 <AnimationControls 
                    animSettings={animSettings} 
                    onChange={onAnimChange} 
                    controlDef={control}
                 />
             )}
        </div>
    );
};

const EffectEditor = ({ effect, onParamChange, onRemove, syncSettings = {}, onSetParamSync }) => {
  if (!effect) return null;

  const effectDefinition = effectDefinitions.find(def => def.id === effect.id);

  if (!effectDefinition) return null; // Or error state

  return (
    <div className="effect-editor settings-card">
      <div className="effect-header settings-card-header">
          <h4>{effect.name}</h4>
          <button className="remove-effect-btn" onClick={onRemove}>×</button>
      </div>
      <div className="settings-card-content">
        {effectDefinition.paramControls.map(control => {
          if (control.showIf) {
            const shouldShow = Object.entries(control.showIf).every(([key, value]) => {
              return effect.params[key] === value;
            });
            if (!shouldShow) return null;
          }

          const paramKey = `${effect.id}.${control.id}`;
          // Handle complex sync settings vs legacy string
          const currentAnimSettings = typeof syncSettings[paramKey] === 'object' 
                ? syncSettings[paramKey] 
                : { syncMode: syncSettings[paramKey] };

          return (
            <EffectParameter
                key={control.id}
                control={control}
                value={effect.params[control.id]}
                onChange={(val) => onParamChange(control.id, val)}
                animSettings={currentAnimSettings}
                onAnimChange={(newSettings) => onSetParamSync(paramKey, newSettings)}
                effectId={effect.id}
            />
          );
        })}
      </div>
    </div>
  );
};

export default EffectEditor;