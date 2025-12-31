import React, { useState, useRef } from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';
import Mappable from './Mappable';
import RangeSlider from './RangeSlider';
import CollapsiblePanel from './CollapsiblePanel';

// Icons as simple SVGs or characters
const Icons = {
    Backward: () => <span>&lt;|</span>,
    Pause: () => <span>||</span>,
    Forward: () => <span>|&gt;</span>,
    Once: () => <span>-&gt;|</span>,
    Bounce: () => <span>|&lt;-&gt;|</span>,
    Loop: () => <span>Loop</span>
};

const AnimationControls = ({ animSettings, onChange }) => {
    const { 
        direction = 'forward', 
        style = 'loop', 
        syncMode = null 
    } = animSettings || {};

    const update = (key, val) => onChange({ ...animSettings, [key]: val });

    return (
        <div className="anim-row controls-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                 {/* Play Direction */}
                <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                    <button className={`speed-control-button ${direction === 'backward' ? 'active' : ''}`} onClick={() => update('direction', 'backward')} title="Backward" style={{flex:1, padding:0, fontSize:'10px'}}>
						&lt;|
					</button>
                    <button className={`speed-control-button ${direction === 'pause' ? 'active' : ''}`} onClick={() => update('direction', 'pause')} title="Pause" style={{flex:1, padding:0, fontSize:'10px'}}>
						||
					</button>
                    <button className={`speed-control-button ${direction === 'forward' ? 'active' : ''}`} onClick={() => update('direction', 'forward')} title="Forward" style={{flex:1, padding:0, fontSize:'10px'}}>
						|&gt;
					</button>
                </div>
                 {/* Play Style */}
                <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                    <button className={`speed-control-button ${style === 'once' ? 'active' : ''}`} onClick={() => update('style', 'once')} title="Once" style={{flex:1, padding:0, fontSize:'10px'}}>
                        -&gt;|
					</button>
                    <button className={`speed-control-button ${style === 'bounce' ? 'active' : ''}`} onClick={() => update('style', 'bounce')} title="Bounce" style={{flex:1, padding:0, fontSize:'10px'}}>
                        |&lt;&gt;|
					</button>
                    <button className={`speed-control-button ${style === 'loop' ? 'active' : ''}`} onClick={() => update('style', 'loop')} title="Loop" style={{flex:1, padding:0, fontSize:'10px'}}>
						Loop
					</button>
                </div>
                 {/* Sync Mode */}
                <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                    <button className={`speed-control-button ${syncMode === 'fps' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'fps' ? null : 'fps')} style={{flex:1, padding:0, fontSize:'10px'}}>F</button>
                    <button className={`speed-control-button ${syncMode === 'timeline' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'timeline' ? null : 'timeline')} style={{flex:1, padding:0, fontSize:'10px'}}>T</button>
                    <button className={`speed-control-button ${syncMode === 'bpm' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'bpm' ? null : 'bpm')} style={{flex:1, padding:0, fontSize:'10px'}}>B</button>
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

    // Range Logic
    const currentRange = animSettings?.range || [control.min, control.max];
    const handleRangeChange = (newRange) => {
        onAnimChange({ ...animSettings, range: newRange });
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
             {/* Row 1: Label (Span 3 if we were using a 3-column grid for outer, but here we nest) */}
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
                                onChange={onChange} // Update Main Value
                                onRangeChange={handleRangeChange} // Update Animation Range
                                showRange={expanded} // Show Min/Max handles only when expanded
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

             {/* Row 3: Animation Settings (Unfolded) - Spans full width */}
             {expanded && (control.type === 'range') && (
                 <div className="param-anim-settings" style={{ marginTop: '5px', padding: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                    <AnimationControls 
                        animSettings={animSettings} 
                        onChange={onAnimChange} 
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