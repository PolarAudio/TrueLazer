import React, { useState, useRef } from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';
import Mappable from './Mappable';
import RangeSlider from './RangeSlider';
import DualRangeSlider from './DualRangeSlider';
import CollapsiblePanel from './CollapsiblePanel';
import AnimationControls from './AnimationControls';
import ColorPicker from './ColorPicker';
import { PresetSelector } from './PresetSelector';

const EffectParameter = ({ control, value, onChange, animSettings, onAnimChange, effectId, context, progressRef, workerId, clipDuration, bpm, getFftLevels, uiState, onUpdateUiState, paramKey, link = null }) => {
// ... existing EffectParameter ...
    const [hovered, setHovered] = useState(false);

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
             <div className="param-row-label" style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '4px' }}>
                {link && (
                    <button
                        className={`link-xy-btn ${link.linked ? 'active' : ''}`}
                        onClick={link.onToggle}
                        title={link.linked ? 'Linked – Y follows X exactly (click to unlink)' : 'Unlinked – click to link Y to X'}
                        style={{ background: 'none', border: 'none', padding: 0, display: 'flex', cursor: 'pointer', fontSize: '11px', color: link.linked ? 'var(--theme-color, #4c8bf5)' : '#666' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/>
                            <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.374 3.528a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
                        </svg>
                    </button>
                )}
                <label className="param-label" draggable onDragStart={handleDragStart} style={{fontSize: '11px', color: '#aaa'}}>{control.label}</label>
             </div>

             {/* Row 2: Gear | RangeSlider | Value Input */}
             <div className="param-row-control" style={{ display: 'grid', gridTemplateColumns: '20px 1fr 60px', gap: '5px', alignItems: 'center' }}>
                {/* Col 1: Gear */}
                <button 
                    className={`anim-toggle-btn ${expanded ? 'active' : ''}`}
                    style={{ 
                        visibility: link?.linked ? 'hidden' : ((hovered || expanded || animSettings?.syncMode) ? 'visible' : 'hidden'), 
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
                        control.isRange ? (
                            <DualRangeSlider
                                min={control.min}
                                max={control.max}
                                step={control.step}
                                value={value}
                                onChange={onChange}
                            />
                        ) : (
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
                        )
                    ) : control.type === 'text' ? (
                         <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="param-text-input" />
                    ) : control.type === 'checkbox' ? (
                        <Mappable id={`${effectId}_${control.id}`}>
                         <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="param-checkbox" />
                        </Mappable>
                    ) : control.type === 'select' ? (
                        <Mappable id={`${effectId}_${control.id}`}>
                            <select value={value} onChange={(e) => onChange(e.target.value)} className="param-select">
                                {control.options.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </Mappable>
                    ) : null}
                </div>

                {/* Col 3: Value Display */}
                 {control.type === 'range' && !control.isRange && (
                    <input
                        type="number"
                        value={typeof value === 'number' ? value.toFixed(2) : value}
                        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                        className="param-number-input"
                        step={control.step}
                        style={{ fontSize: '10px'}}
                    />
                 )}
             </div>

             {/* Row 3: Animation Settings (Unfolded) */}
             {expanded && !link?.linked && (control.type === 'range') && (
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

const CustomOrderEditor = ({ customOrder = [], assignedDacs = [], dacSettings = {}, onChange }) => {
    const [draggedKey, setDraggedKey] = useState(null);
    const keyOf = (d) => (d && d.ip !== undefined) ? `${d.ip}:${d.channel !== undefined ? d.channel : ''}` : null;
    const resolveDacLabel = (d) => {
        const k = keyOf(d);
        const custom = k ? dacSettings[k]?.name : null;
        if (custom) return custom;
        return `Ch ${d.channel} (${d.hostName || d.ip})`;
    };

    // Always reflect the currently-assigned channels, keeping the saved custom
    // order where possible and appending any newly assigned channels last.
    const assignedItems = assignedDacs
        .map((d, i) => ({ ip: d.ip, channel: d.channel, label: resolveDacLabel(d), originalIndex: i }));
    const savedItems = (customOrder && customOrder.length > 0) ? customOrder : [];
    const items = assignedItems.length > 0
        ? [...assignedItems].sort((a, b) => {
            const ia = savedItems.findIndex(item => keyOf(item) === keyOf(a));
            const ib = savedItems.findIndex(item => keyOf(item) === keyOf(b));
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        })
        : savedItems.map(item => ({ ...item, label: item.label || resolveDacLabel(item) }));

    const commitOrder = (list) => {
        onChange(list.map(item => ({
            ip: item.ip,
            channel: item.channel,
            label: item.label || resolveDacLabel(item),
            originalIndex: item.originalIndex
        })));
    };

    const moveItem = (from, to) => {
        if (to < 0 || to >= items.length) return;
        const list = [...items];
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
        commitOrder(list);
    };

    const handleDragStart = (e, index) => {
        e.dataTransfer.effectAllowed = 'move';
        setDraggedKey(keyOf(items[index]));
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        const targetKey = keyOf(items[index]);
        if (draggedKey === null || draggedKey === targetKey) return;
        const from = items.findIndex(it => keyOf(it) === draggedKey);
        if (from === -1 || from === index) return;
        const list = [...items];
        const [moved] = list.splice(from, 1);
        list.splice(index, 0, moved);
        commitOrder(list);
    };

    const handleDragEnd = () => setDraggedKey(null);

    return (
        <div className="custom-order-editor" style={{ marginBottom: '10px', padding: '5px', background: '#222', borderRadius: '4px' }}>
            <label style={{fontSize: '10px', color: '#888'}}>Channel Order (drag or use arrows)</label>
            <ul style={{ listStyle: 'none', padding: 0, margin: '5px 0' }}>
                {items.map((item, index) => {
                    const itemKey = keyOf(item);
                    return (
                    <li
                        key={itemKey || index}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        style={{
                            background: draggedKey === itemKey ? '#444' : '#333',
                            border: '1px solid #555',
                            padding: '4px',
                            marginBottom: '2px',
                            fontSize: '10px',
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }}
                    >
                        <span style={{ color: '#666' }}>☰</span>
                        <span style={{ color: '#888', fontSize: '9px', minWidth: '14px' }}>{index + 1}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.label || (itemKey ? dacSettings[itemKey]?.name : null) || `Ch ${item.channel} ${item.ip ? `(${item.ip})` : ''}`}
                        </span>
                        <span className="custom-order-controls" style={{ display: 'flex', gap: '2px' }}>
                            <button className="dac-order-btn" disabled={index === 0} onClick={() => moveItem(index, index - 1)} title="Move up">▲</button>
                            <button className="dac-order-btn" disabled={index === items.length - 1} onClick={() => moveItem(index, index + 1)} title="Move down">▼</button>
                        </span>
                    </li>
                    );
                })}
            </ul>
        </div>
    );
};

const ColorEffectEditor = ({ effect, onParamChange, syncSettings, onSetParamSync, context, progressRef, workerId, clipDuration, bpm, getFftLevels, uiState, onUpdateUiState }) => {
    const { mode, color, paletteColors = [], paletteSize = 4 } = effect.params;
    const [activePaletteIndex, setActivePaletteIndex] = useState(0);

    // Track advanced HSV visibility in clip UI state
    const showHsv = !!uiState?.showHsv?.[effect.instanceId || effect.id];
    const setShowHsv = (val) => {
        if (onUpdateUiState) {
            onUpdateUiState({
                showHsv: {
                    [effect.instanceId || effect.id]: val
                }
            });
        }
    };

    const updatePaletteColor = (hex) => {
        const newColors = [...paletteColors];
        while (newColors.length < 16) newColors.push('#ffffff');
        newColors[activePaletteIndex] = hex;
        onParamChange('paletteColors', newColors);
    };

    const effectDefinition = effectDefinitions.find(d => d.id === 'color');

    // Helper to convert Hex to HSV for the sliders
    const hexToHsvLocal = (hex) => {
        if (!hex) return { h: 0, s: 0, v: 1 };
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        const d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) h = 0;
        else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h, s, v };
    };

    const handleColorPickerChange = (hex) => {
        onParamChange('color', hex);
        // Also update HSV params for animation base values
        const hsv = hexToHsvLocal(hex);
        onParamChange('hue', hsv.h);
        onParamChange('saturation', hsv.s);
        onParamChange('brightness', hsv.v);
    };

    const presets = [
        { name: 'RGBY', colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'] },
        { name: 'CYBER', colors: ['#ff00ff', '#00ffff', '#ffffff', '#0000ff'] },
        { name: 'FIRE', colors: ['#ff8800', '#ff0000', '#ffff00', '#880000'] },
        { name: 'ICE', colors: ['#0000ff', '#0088ff', '#00ffff', '#ffffff'] }
    ];

    const renderParam = (id) => {
        const control = effectDefinition.paramControls.find(c => c.id === id);
        if (!control) return null;
        const paramKey = `${effect.instanceId || effect.id}.${control.id}`;
        return (
            <EffectParameter
                key={id}
                control={control}
                value={effect.params[id]}
                onChange={(val) => onParamChange(id, val)}
                animSettings={syncSettings[paramKey]}
                onAnimChange={(newSettings) => onSetParamSync(paramKey, newSettings)}
                effectId={effect.id}
                context={context}
                progressRef={progressRef}
                workerId={workerId}
                clipDuration={clipDuration}
                bpm={bpm}
                getFftLevels={getFftLevels}
                uiState={uiState}
                onUpdateUiState={onUpdateUiState}
                paramKey={paramKey}
            />
        );
    };

    return (
        <div className="color-effect-editor">
            {renderParam('mode')}

            {mode === 'solid' && (
                <div style={{ marginTop: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                        <label style={{ fontSize: '11px', color: '#aaa' }}>Pick Color</label>
                        <button 
                            className={`anim-toggle-btn ${showHsv ? 'active' : ''}`}
                            style={{ background: 'none', border: 'none', color: showHsv ? 'var(--theme-color)' : '#666', cursor: 'pointer', padding: 0, fontSize: '14px' }}
                            onClick={() => setShowHsv(!showHsv)}
                            title="Advanced HSV Controls"
                        >⚙</button>
                    </div>
                    
                    {!showHsv && <ColorPicker color={color || '#ffffff'} onChange={handleColorPickerChange} />}
                    
                    {showHsv && (
                        <div className="hsv-sliders" style={{ padding: '5px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                            {renderParam('hue')}
                            {renderParam('saturation')}
                            {renderParam('brightness')}
                            <div style={{ marginTop: '5px', height: '10px', borderRadius: '2px', background: color || '#ffffff', border: '1px solid #444' }} />
                        </div>
                    )}
                </div>
            )}

            {mode === 'palette' && (
                <div style={{ marginTop: '10px' }}>
                    {renderParam('paletteSize')}
                    {renderParam('paletteSpread')}
                    {renderParam('cycleSpeed')}
                    {renderParam('rainbowOffset')}

                    <label style={{ fontSize: '11px', color: '#aaa', display: 'block', margin: '10px 0 5px' }}>Presets</label>
                    <div className="preset-row" style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
                        {presets.map(p => (
                            <button 
                                key={p.name}
                                onClick={() => onParamChange('paletteColors', p.colors)}
                                style={{ 
                                    fontSize: '9px', padding: '2px 5px', background: '#333', 
                                    color: '#ccc', border: '1px solid #444', borderRadius: '3px', cursor: 'pointer' 
                                }}
                            >{p.name}</button>
                        ))}
                    </div>

                    <label style={{ fontSize: '11px', color: '#aaa', display: 'block', margin: '10px 0 5px' }}>Palette Colors</label>
                    <div className="palette-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                        {Array.from({ length: paletteSize }).map((_, i) => (
                            <div 
                                key={i}
                                onClick={() => setActivePaletteIndex(i)}
                                style={{
                                    width: '20px', height: '20px',
                                    background: paletteColors[i] || '#ffffff',
                                    border: activePaletteIndex === i ? '2px solid white' : '1px solid #444',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    boxSizing: 'border-box'
                                }}
                            />
                        ))}
                    </div>
                    <ColorPicker 
                        color={paletteColors[activePaletteIndex] || '#ffffff'} 
                        onChange={updatePaletteColor} 
                    />
                </div>
            )}

            {mode === 'rainbow' && (
                <div style={{ marginTop: '10px' }}>
                    {renderParam('cycleSpeed')}
                    {renderParam('rainbowSpread')}
                    {renderParam('rainbowOffset')}
                    {renderParam('rainbowPalette')}
                </div>
            )}
        </div>
    );
};

const EffectEditor = ({ effect, assignedDacs = [], dacSettings = {}, onParamChange, onRemove, syncSettings = {}, onSetParamSync, context = {}, progressRef, clipDuration, bpm, getFftLevels, uiState, onUpdateUiState, dragHandle, onRegisterPreset, currentPointCount }) => {
  if (!effect) return null;
  const effectDefinition = effectDefinitions.find(def => def.id === effect.id);
  if (!effectDefinition) return null;

  const isDelay = effect.id === 'delay';
  const isChase = effect.id === 'chase';
  const isColor = effect.id === 'color';
  const isEnabled = effect.params.enabled !== false;
  const isChannelMode = effect.params.mode === 'channel';

  const showSegmentThresholdWarning = isDelay && effect.params.mode === 'segment' && currentPointCount > 0 && currentPointCount < 5;

  const collapsedEffects = uiState?.collapsedEffects || {};
  const isCollapsed = !!collapsedEffects[effect.instanceId || effect.id];

  const handleToggle = (val) => {
    if (onUpdateUiState) {
        onUpdateUiState({
            collapsedEffects: {
                [effect.instanceId || effect.id]: val
            }
        });
    }
  };

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
        isCollapsed={isCollapsed}
        onToggle={handleToggle}
        dragHandle={dragHandle}
        headerActions={
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
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
        <PresetSelector 
            type="effect" 
            subType={effect.id} 
            currentParams={effect.params}
            onRegisterPreset={onRegisterPreset}
            onApplyPreset={(params) => {
                Object.entries(params).forEach(([key, val]) => {
                    onParamChange(key, val);
                });
            }}
        />
        {isColor ? (
            <ColorEffectEditor 
                effect={effect}
                onParamChange={onParamChange}
                syncSettings={syncSettings}
                onSetParamSync={onSetParamSync}
                context={context}
                progressRef={progressRef}
                workerId={context.workerId}
                clipDuration={clipDuration}
                bpm={bpm}
                getFftLevels={getFftLevels}
                uiState={uiState}
                onUpdateUiState={onUpdateUiState}
            />
        ) : (
            <>
                {isDelay && (
                    <>
                        {effect.params.useCustomOrder && (
                            <CustomOrderEditor 
                                customOrder={effect.params.customOrder} 
                                assignedDacs={assignedDacs}
                                dacSettings={dacSettings}
                                onChange={(newOrder) => onParamChange('customOrder', newOrder)}
                            />
                        )}
                        {showSegmentThresholdWarning && (
                            <div className="effect-warning" style={{ color: '#ff4444', fontSize: '10px', marginBottom: '10px', padding: '5px', background: 'rgba(255,0,0,0.1)', borderRadius: '3px', border: '1px solid rgba(255,0,0,0.2)' }}>
                                ⚠ Insufficient point count for segment delay (min 5 points).
                            </div>
                        )}
                    </>
                )}

                {isChase && effect.params.useCustomOrder && (
                    <CustomOrderEditor 
                        customOrder={effect.params.customOrder} 
                        assignedDacs={assignedDacs}
                        dacSettings={dacSettings}
                        onChange={(newOrder) => onParamChange('customOrder', newOrder)}
                    />
                )}

                {effectDefinition.paramControls.map(control => {
                if ((isDelay || isChase) && (['customOrder'].includes(control.id))) return null;
                if (control.showIf) {
                    const shouldShow = Object.entries(control.showIf).every(([key, value]) => {
                        if (Array.isArray(value)) {
                            return value.includes(effect.params[key]);
                        }
                        return effect.params[key] === value;
                    });
                    if (!shouldShow) return null;
                }
                const paramKey = `${effect.instanceId || effect.id}.${control.id}`;
                const currentAnimSettings = typeof syncSettings[paramKey] === 'object' 
                        ? syncSettings[paramKey] 
                        : { syncMode: syncSettings[paramKey] };

                // X/Y link handling: pairs defined in the effect definition stay
                // in lockstep by default (`linkXY` flag) with a chain toggle on
                // the second axis.
                const effectPairs = effectDefinition.linkPairs || [];
                const secondOfPair = effectPairs.find(p => p[1] === control.id);
                const firstOfPair = effectPairs.find(p => p[0] === control.id);
                const linkXY = effect.params.linkXY !== false;

                let displayValue = effect.params[control.id];
                let displayOnChange = (val) => onParamChange(control.id, val);
                let displayAnimSettings = currentAnimSettings;
                let linkProps = null;

                if (secondOfPair) {
                    const partnerId = secondOfPair[0];
                    linkProps = { linked: linkXY, onToggle: () => onParamChange('linkXY', !linkXY) };
                    if (linkXY) {
                        displayValue = effect.params[partnerId];
                        displayOnChange = (val) => {
                            onParamChange(partnerId, val);
                            onParamChange(control.id, val);
                        };
                        if (!currentAnimSettings.syncMode) {
                            const partnerKey = `${effect.instanceId || effect.id}.${partnerId}`;
                            const partnerAnim = typeof syncSettings[partnerKey] === 'object'
                                ? syncSettings[partnerKey]
                                : (syncSettings[partnerKey] ? { syncMode: syncSettings[partnerKey] } : null);
                            if (partnerAnim) displayAnimSettings = partnerAnim;
                        }
                    }
                } else if (firstOfPair && linkXY) {
                    const partnerId = firstOfPair[1];
                    displayOnChange = (val) => {
                        onParamChange(firstOfPair[0], val);
                        onParamChange(partnerId, val);
                    };
                }

                return (
                    <EffectParameter
                        key={control.id}
                        control={control}
                        value={displayValue}
                        onChange={displayOnChange}
                        animSettings={displayAnimSettings}
                        onAnimChange={(newSettings) => onSetParamSync(paramKey, newSettings)}
                        effectId={effect.id}
                        context={context}
                        progressRef={progressRef}
                        workerId={context.workerId}
                        clipDuration={clipDuration}
                        bpm={bpm}
                        getFftLevels={getFftLevels}
                        uiState={uiState}
                        onUpdateUiState={onUpdateUiState}
                        paramKey={paramKey}
                        link={linkProps}
                    />
                );
                })}
            </>
        )}
    </CollapsiblePanel>
  );
};

export default React.memo(EffectEditor);
