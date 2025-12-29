import React, { useState, useRef } from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';
import Mappable from './Mappable';
import RangeSlider from './RangeSlider';
import CollapsiblePanel from './CollapsiblePanel';

const AnimationControls = ({ animSettings, onChange, controlDef }) => {
    const { 
        range = [controlDef.min, controlDef.max], 
        direction = 'forward', 
        style = 'loop', 
        syncMode = null 
    } = animSettings || {};

    const update = (key, val) => onChange({ ...animSettings, [key]: val });

    return (
        <div className="animation-controls-grid" style={{display: 'grid', gridTemplateRows: 'auto auto', gap: '5px'}}>
            {/* Row 1: Range Selection */}
            <div className="anim-row range-row" style={{ width: '100%' }}>
                <RangeSlider 
                    min={controlDef.min} 
                    max={controlDef.max} 
                    step={controlDef.step} 
                    value={range}
                    onChange={(newRange) => update('range', newRange)}
                />
            </div>
            {/* Row 2: Settings Buttons */}
            <div className="anim-row controls-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                 {/* Play Direction */}
                <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                    <button className={`speed-control-button ${direction === 'backward' ? 'active' : ''}`} onClick={() => update('direction', 'backward')} title="Backward" style={{flex:1, padding:0, fontSize:'10px'}}>
						&lt;
					</button>
                    <button className={`speed-control-button ${direction === 'pause' ? 'active' : ''}`} onClick={() => update('direction', 'pause')} title="Pause" style={{flex:1, padding:0, fontSize:'10px'}}>
						||
					</button>
                    <button className={`speed-control-button ${direction === 'forward' ? 'active' : ''}`} onClick={() => update('direction', 'forward')} title="Forward" style={{flex:1, padding:0, fontSize:'10px'}}>
						&gt;
					</button>
                </div>
                 {/* Play Style */}
                <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                    <button className={`speed-control-button ${style === 'once' ? 'active' : ''}`} onClick={() => update('style', 'once')} title="Once" style={{flex:1, padding:0, fontSize:'10px'}}>
                        |&gt;|
					</button>
                    <button className={`speed-control-button ${style === 'bounce' ? 'active' : ''}`} onClick={() => update('style', 'bounce')} title="Bounce" style={{flex:1, padding:0, fontSize:'10px'}}>
                        &lt;&gt;
					</button>
                    <button className={`speed-control-button ${style === 'loop' ? 'active' : ''}`} onClick={() => update('style', 'loop')} title="Loop" style={{flex:1, padding:0, fontSize:'10px'}}>
						O
					</button>
                </div>
                 {/* Sync Mode */}
                <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                    <button className={`speed-control-button ${syncMode === 'fps' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'fps' ? null : 'fps')} style={{flex:1, padding:0, fontSize:'10px'}}>F</button>
                    <button className={`speed-control-button ${syncMode === 'timeline' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'timeline' ? null : 'timeline')} style={{flex:1, padding:0, fontSize:'10px'}}>T</button>
                    <button className={`speed-control-button ${syncMode === 'bpm' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'bpm' ? null : 'bpm')} style={{flex:1, padding:0, fontSize:'10px'}}>B</button>
                </div>
            </div>
        </div>
    );
};

const EffectParameter = ({ control, value, onChange, animSettings, onAnimChange, effectId, context }) => {
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

    return (
        <div 
            className={`param-editor ${expanded ? 'expanded' : ''}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ marginBottom: '8px' }}
        >
             {/* Row 1: Label */}
             <div className="param-row-label">
                <label className="param-label" draggable onDragStart={handleDragStart}>{control.label}</label>
             </div>

             {/* Row 2: Gear, Control, Value */}
             <div className="param-row-control" style={{ display: 'flex', alignItems: 'center' }}>
                <button 
                    className={`anim-toggle-btn ${expanded ? 'active' : ''}`}
                    style={{ 
                        visibility: (hovered || expanded || animSettings.syncMode) ? 'visible' : 'hidden', 
                        marginRight: '5px',
                        background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 2px'
                    }}
                    onClick={() => setExpanded(!expanded)}
                    title="Animate"
                >
					⚙
				</button>

                <div className="control-input-wrapper" style={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
                    {control.type === 'range' && (
                    <>
                        {/* We use RangeSlider here as the Value slider? 
                            User said: "One Slider for Value and range cropping". 
                            If expanded, we show the RangeSlider controls in Row 3 (AnimationControls).
                            But here we need to control the VALUE. 
                            Wait, if we use RangeSlider for value, it returns [min, max].
                            But effect value is a single number.
                            So we use a standard slider here for the Value.
                            The RangeSlider in AnimationControls controls the MIN/MAX BOUNDS of animation.
                        */}
                        <Mappable id={`${effectId}_${control.id}`} style={{flexGrow: 1, marginRight: '5px'}}>
                        <input
                            type="range"
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={value}
                            onChange={(e) => onChange(parseFloat(e.target.value))}
                            className="param-slider"
                            style={{width: '100%'}}
                        />
                        </Mappable>
                        <input
                            type="number"
                            value={typeof value === 'number' ? value.toFixed(2) : value}
                            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                            className="param-number-input"
                            step={control.step}
                            style={{width: '50px'}}
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
                    <div draggable onDragStart={handleDragStart}>
                        <Mappable id={`${effectId}_${control.id}`}>
                        <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) => onChange(e.target.checked)}
                            className="param-checkbox"
                        />
                        </Mappable>
                    </div>
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
             </div>

             {/* Row 3: Animation Settings (Unfolded) */}
             {expanded && (control.type === 'range' || control.type === 'number') && (
                 <div className="param-anim-settings" style={{ marginTop: '5px', padding: '5px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                    <AnimationControls 
                        animSettings={animSettings} 
                        onChange={onAnimChange} 
                        controlDef={control}
                    />
                 </div>
             )}
        </div>
    );
};

// Custom Order Editor Component
const CustomOrderEditor = ({ customOrder = [], assignedDacs = [], onChange }) => {
    // If customOrder is empty, populate with assignedDacs indices initially?
    // Or just show assignedDacs and let user "Enable/Reorder"?
    // User said: "list the avialebale Channels... change the order... used for calculating delay".
    // We should probably show a list of items.
    
    // State to manage list if we want drag/drop without commit every frame?
    // Actually, we commit to parent onChange.

    // available items: assignedDacs (which have name/ip/channel).
    // The "customOrder" array probably stores indices of assignedDacs? 
    // Or maybe it stores unique IDs of channels?
    // Let's store the INDEX into assignedDacs for simplicity, assuming assignedDacs doesn't change often.
    // Or better: Store { ip, channel } objects.

    // Logic:
    // 1. If customOrder is empty, initialize it with assignedDacs (default order).
    // 2. Render list.
    
    const [draggedItem, setDraggedItem] = useState(null);

    const items = (customOrder && customOrder.length > 0) 
        ? customOrder 
        : assignedDacs.map((d, i) => ({ ip: d.ip, channel: d.channel, label: `Ch ${d.channel} (${d.hostName || d.ip})`, originalIndex: i }));

    // If items are just objects, we need to ensure they match assignedDacs to display labels if we stored only IDs.
    // For now, let's assume we store full object or at least enough info.

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
    
    // Ensure we trigger onChange if we initialized from default
    // (This might cause infinite loop if not careful. Only if customOrder was empty).
    // We'll let the user explicitly interact to save.

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

const EffectEditor = ({ effect, assignedDacs = [], onParamChange, onRemove, syncSettings = {}, onSetParamSync, context = {} }) => {
  if (!effect) return null;

  const effectDefinition = effectDefinitions.find(def => def.id === effect.id);

  if (!effectDefinition) return null;

  const isDelay = effect.id === 'delay';

  return (
    <CollapsiblePanel 
        title={effect.name} 
        headerActions={
            <button className="remove-effect-btn" onClick={onRemove}>×</button>
        }
    >
        {/* Special UI for Delay Effect */}
        {isDelay && (
            <>
                {/* Custom Order UI if Custom Order Mode is enabled */}
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
          // Filter out params we handled manually
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
            />
          );
        })}
    </CollapsiblePanel>
  );
};

export default EffectEditor;