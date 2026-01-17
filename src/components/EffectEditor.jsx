import React, { useState, useRef } from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';
import Mappable from './Mappable';
import RangeSlider from './RangeSlider';
import CollapsiblePanel from './CollapsiblePanel';
import AnimationControls from './AnimationControls';

const EffectParameter = ({ control, value, onChange, animSettings, onAnimChange, effectId, context, progressRef, workerId, clipDuration, bpm, getFftLevels }) => {
    const [expanded, setExpanded] = useState(false);
    const [hovered, setHovered] = useState(false);

    const handleDragStart = (e) => {
        e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
            type: control.type,
            paramName: control.id,
            effectId: effectId,
            min: control.min,
            max: control.max,
            step: control.step,
            ...context
        }));
    };

    // Range Logic
    const currentRange = animSettings?.range || [control.min, control.max];
    const handleRangeChange = (newRange) => {
        onAnimChange({ ...animSettings, range: newRange });
    };

    // Wrap onAnimChange for AnimationControls to ensure range is present
    const handleAnimControlChange = (newSettings) => {
        onAnimChange({
            range: currentRange, // Ensure range is set (using default if missing)
            ...newSettings
        });
    };

    return (
        <div 
            className={`param-editor ${expanded ? 'expanded' : ''}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ 
                marginBottom: '8px', 
                display: 'grid', 
                gridTemplateColumns: '1fr', // Container grid
                gap: '2px'
            }}
        >
             {/* Row 1: Label */}
             <div className="param-row-label" style={{ width: '100%' }}>
                <label className="param-label" draggable onDragStart={handleDragStart} style={{fontSize: '11px', color: '#aaa'}}>{control.label}</label>
             </div>

             {/* Row 2: Gear | RangeSlider | Value Input */}
             <div className="param-row-control" style={{ display: 'grid', gridTemplateColumns: '20px 1fr 50px', gap: '5px', alignItems: 'center' }}>
                {/* Col 1: Gear */}
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

                {/* Col 2: Slider (Value & Range) */}
                <div className="control-input-wrapper" style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    {control.type === 'range' ? (
                        <Mappable id={`${effectId}_${control.id}`} style={{width: '100%'}}>
                            <RangeSlider
                                min={control.min}
                                max={control.max}
                                step={control.step}
                                value={value}
                                rangeValue={currentRange}
                                onChange={onChange} 
                                onRangeChange={handleRangeChange} 
                                showRange={expanded} 
                                animSettings={animSettings}
                                progressRef={progressRef}
                                workerId={workerId}
                                clipDuration={clipDuration}
                                bpm={bpm}
                                getFftLevels={getFftLevels}
                            />
                        </Mappable>
                    ) : control.type === 'text' ? (
                         <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="param-text-input" />
                    ) : control.type === 'checkbox' ? (
                        <Mappable id={`${effectId}_${control.id}`}>
                         <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="param-checkbox" />
                        </Mappable>
                    ) : control.type === 'select' ? (
                        <select value={value} onChange={(e) => onChange(e.target.value)} className="param-select">
                            {control.options.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                    ) : null}
                </div>

                {/* Col 3: Value Display */}
                 {control.type === 'range' && (
                    <input
                        type="number"
                        value={typeof value === 'number' ? value.toFixed(2) : value}
                        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                        className="param-number-input"
                        step={control.step}
                        style={{width: '100%', fontSize: '10px'}}
                    />
                 )}
             </div>

             {/* Row 3: Animation Settings (Unfolded) */}
             {expanded && (control.type === 'range') && (
                 <div className="param-anim-settings" style={{ marginTop: '5px', padding: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                    <AnimationControls 
                        animSettings={animSettings} 
                        onChange={handleAnimControlChange} 
                    />
                 </div>
             )}
        </div>
    );
};

const CustomOrderEditor = ({ customOrder = [], assignedDacs = [], onChange }) => {
    const [draggedItem, setDraggedItem] = useState(null);
    const items = (customOrder && customOrder.length > 0) 
        ? customOrder 
        : assignedDacs.map((d, i) => ({ ip: d.ip, channel: d.channel, label: `Ch ${d.channel} (${d.hostName || d.ip})`, originalIndex: i }));

    const handleDragStart = (e, index) => {
        setDraggedItem(items[index]);
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        const draggedOverItem = items[index];
        if (draggedItem === draggedOverItem) return;
        const newItems = items.filter(item => item !== draggedItem);
        newItems.splice(index, 0, draggedItem);
        onChange(newItems);
    };

    return (
        <div className="custom-order-editor" style={{ marginBottom: '10px', padding: '5px', background: '#222', borderRadius: '4px' }}>
            <label style={{fontSize: '10px', color: '#888'}}>Channel Order (Drag to Sort)</label>
            <ul style={{ listStyle: 'none', padding: 0, margin: '5px 0' }}>
                {items.map((item, index) => (
                    <li 
                        key={index}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        style={{
                            background: '#333', 
                            border: '1px solid #444', 
                            padding: '4px', 
                            marginBottom: '2px', 
                            fontSize: '10px', 
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <span style={{marginRight: '5px', color: '#666'}}>☰</span>
                        {item.label || `Ch ${item.channel} ${item.ip ? `(${item.ip})` : ''}`}
                    </li>
                ))}
            </ul>
        </div>
    );
};

const EffectEditor = ({ effect, assignedDacs = [], onParamChange, onRemove, syncSettings = {}, onSetParamSync, context = {}, progressRef, clipDuration, bpm, getFftLevels }) => {
  if (!effect) return null;
  const effectDefinition = effectDefinitions.find(def => def.id === effect.id);
  if (!effectDefinition) return null;

  const isDelay = effect.id === 'delay';
  const isChase = effect.id === 'chase';
  const isEnabled = effect.params.enabled !== false;
  const isChannelMode = effect.params.mode === 'channel';

  const handleBlackoutDragStart = (e) => {
    e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
        type: 'toggle',
        paramName: 'enabled',
        label: `${effect.name} ON`,
        ...context
    }));
  };

  return (
    <CollapsiblePanel 
        title={effect.name} 
        headerActions={
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                {(isDelay || isChase) && (
                    <button 
                        className="mode-toggle-btn" 
                        onClick={() => onParamChange('mode', isChannelMode ? 'frame' : 'channel')}
                        style={{ 
                            fontSize: '9px', 
                            padding: '2px 5px', 
                            background: isChannelMode ? '#444' : 'var(--theme-color)', 
                            border: 'none', 
                            color: 'white', 
                            borderRadius: '3px',
                            cursor: 'pointer'
                        }}
                    >
                        {isChannelMode ? 'CHANNEL' : 'FRAME'}
                    </button>
                )}
                <Mappable id={`${effect.id}_blackout`}>
                    <button 
                        className={`layer-control-button ${!isEnabled ? 'active' : ''}`} 
                        onClick={() => onParamChange('enabled', !isEnabled)}
                        draggable
                        onDragStart={handleBlackoutDragStart}
                        style={{ padding: '2px', background: !isEnabled ? 'red' : 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex' }}
                        title="Toggle Effect"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                            <path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7 7 0 0 0 2.79-.588M5.21 3.088A7 7 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474z"/>
                            <path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171 6-12-12 .708-.708 12 12z"/>
                        </svg>
                    </button>
                </Mappable>
                <button className="remove-effect-btn" onClick={onRemove}>×</button>
            </div>
        }
    >
        {isDelay && (
            <>
                {effect.params.useCustomOrder && (
                    <CustomOrderEditor 
                        customOrder={effect.params.customOrder} 
                        assignedDacs={assignedDacs}
                        onChange={(newOrder) => onParamChange('customOrder', newOrder)}
                    />
                )}
            </>
        )}

        {effectDefinition.paramControls.map(control => {
          if (isDelay && (['customOrder'].includes(control.id))) return null;
          if (control.showIf) {
            const shouldShow = Object.entries(control.showIf).every(([key, value]) => {
              return effect.params[key] === value;
            });
            if (!shouldShow) return null;
          }
          const paramKey = `${effect.id}.${control.id}`;
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
                context={context}
                progressRef={progressRef}
                workerId={context.workerId}
                clipDuration={clipDuration}
                bpm={bpm}
                getFftLevels={getFftLevels}
            />
          );
        })}
    </CollapsiblePanel>
  );
};

export default EffectEditor;
