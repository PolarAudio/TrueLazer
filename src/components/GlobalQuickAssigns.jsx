import React, { useCallback } from 'react';
import Mappable from './Mappable';
import RadialKnob from './RadialKnob';

const QuickButton = ({ value, onToggle, label, fullTitle, onDrop, isAssigned, onContextMenu, momentary, onMomentaryStart, onMomentaryEnd, className: extraClassName, ...props }) => {
    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
    };

    const handleDrop = (e) => {
        e.preventDefault();
        try {
            const rawData = e.dataTransfer.getData('application/x-truelazer-param');
            console.log('[QuickButton] Dropped Data Raw:', rawData);
            
            const data = JSON.parse(rawData);
            console.log('[QuickButton] Dropped Data Parsed:', data);

            if (data && (data.type === 'toggle' || data.type === 'checkbox')) {
                onDrop(data);
            } else {
                console.warn('[QuickButton] Invalid data type for button:', data?.type);
            }
        } catch (err) {
            console.error('[QuickButton] Drop Error:', err);
        }
    };

    return (
        <div className={`quick-assign-button ${value ? 'active' : ''} ${!isAssigned ? 'unassigned' : ''} ${extraClassName || ''}`.trim()}
             style={{
                userSelect: 'none',
                width: '90%',
             }}
             onDragOver={handleDragOver} 
             onDrop={handleDrop}
             onContextMenu={onContextMenu}
             {...props}
              onMouseDown={momentary && isAssigned ? (e) => { e.preventDefault(); onMomentaryStart && onMomentaryStart(); } : undefined}
              onMouseUp={momentary && isAssigned ? (e) => { e.preventDefault(); onMomentaryEnd && onMomentaryEnd(); } : undefined}
              onMouseLeave={momentary && isAssigned && value ? (e) => { onMomentaryEnd && onMomentaryEnd(); } : undefined}
			 onClick={!momentary && isAssigned ? onToggle : (e) => e.preventDefault()}
        >
            <div className="button-label" title={fullTitle || label || "Empty"}>{label || "Assign"}</div>
        </div>
    );
};

const GlobalQuickAssigns = ({ assigns, onUpdateKnob, onToggleButton, onAssign, onSetButtonValue }) => {
    const getControlLinks = (control) => Array.isArray(control.links) ? control.links : (control.link ? [control.link] : []);

    const handleContextMenu = (e, type, index, assignments = []) => {
        e.preventDefault();
        const momentary = type === 'button' ? !!(assigns?.buttons?.[index]?.momentary) : false;
        if (window.electronAPI && window.electronAPI.showQuickAssignContextMenu) {
            window.electronAPI.showQuickAssignContextMenu(type, index, assignments, momentary);
        }
    };

    return (
        <div className="global-quick-assigns-panel">
            <div className="quick-assigns-row knobs-row">
                {Array.from({ length: 8 }).map((_, i) => {
                    const knob = assigns.knobs[i];
                    const links = getControlLinks(knob);
                    const isAssigned = links.length > 0;
                    const labels = links.map(l => l.label || l.paramName || l.paramId).filter(Boolean);
                    return (
                        <Mappable key={`knob-${i}`} id={`quick_knob_${i}`}>
                            <RadialKnob 
                                value={knob?.value || 0}
                                label={knob?.label}
                                isAssigned={isAssigned}
                                onChange={(val) => isAssigned && onUpdateKnob(i, val)}
                                onContextMenu={(e) => handleContextMenu(e, 'knob', i, labels)}
                                onDrop={(data) => {
                                    console.log(`[GlobalQuickAssigns] Knob ${i} Drop Data:`, data);
                                    onAssign('knob', i, data);
                                }}
                            />
                        </Mappable>
                    );
                })}
            </div>
            <div className="quick-assigns-row buttons-row">
                {Array.from({ length: 8 }).map((_, i) => {
                    const btn = assigns.buttons[i];
                    const links = getControlLinks(btn);
                    const isAssigned = links.length > 0;
                    const labels = links.map(l => l.label || l.paramName || l.paramId).filter(Boolean);
                    return (
                        <Mappable key={`btn-${i}`} id={`quick_btn_${i}`}>
                            <QuickButton
                                value={btn?.value || false}
                                label={btn?.label}
                                fullTitle={labels.join(' · ')}
                                isAssigned={isAssigned}
                                momentary={!!btn?.momentary}
                                onToggle={() => onToggleButton(i)}
                                onMomentaryStart={() => onSetButtonValue && onSetButtonValue(i, true)}
                                onMomentaryEnd={() => onSetButtonValue && onSetButtonValue(i, false)}
                                onContextMenu={(e) => handleContextMenu(e, 'button', i, labels)}
                                onDrop={(data) => {
                                    console.log(`[GlobalQuickAssigns] Button ${i} Drop Data:`, data);
                                    onAssign('button', i, data);
                                }}
                            />
                        </Mappable>
                    );
                })}
            </div>
        </div>
    );
};

export default GlobalQuickAssigns;