import React, { useCallback } from 'react';
import Mappable from './Mappable';
import RadialKnob from './RadialKnob';

const QuickButton = ({ value, onToggle, label, onDrop, isAssigned, onContextMenu, className: extraClassName, ...props }) => {
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
				cursor: isAssigned ? 'pointer' : 'default', 
				userSelect: 'none',
				width: '90%',
				opacity: isAssigned ? 1 : 0.5,
				}}
             onDragOver={handleDragOver} 
             onDrop={handleDrop}
             onContextMenu={onContextMenu}
             {...props}
			 onClick={isAssigned ? onToggle : (e) => e.preventDefault()}
        >
            <div className="button-label" title={label || "Empty"}>{label || "Assign"}</div>
        </div>
    );
};

const GlobalQuickAssigns = ({ assigns, onUpdateKnob, onToggleButton, onAssign }) => {
    const handleContextMenu = (e, type, index) => {
        e.preventDefault();
        if (window.electronAPI && window.electronAPI.showQuickAssignContextMenu) {
            window.electronAPI.showQuickAssignContextMenu(type, index);
        }
    };

    return (
        <div className="global-quick-assigns-panel">
            <div className="quick-assigns-row knobs-row">
                {Array.from({ length: 8 }).map((_, i) => {
                    const isAssigned = !!assigns.knobs[i].link;
                    return (
                        <Mappable key={`knob-${i}`} id={`quick_knob_${i}`}>
                            <RadialKnob 
                                value={assigns.knobs[i]?.value || 0}
                                label={assigns.knobs[i]?.label}
                                isAssigned={isAssigned}
                                onChange={(val) => isAssigned && onUpdateKnob(i, val)}
                                onContextMenu={(e) => handleContextMenu(e, 'knob', i)}
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
                    const isAssigned = !!assigns.buttons[i].link;
                    return (
                        <Mappable key={`btn-${i}`} id={`quick_btn_${i}`}>
                            <QuickButton
                                value={assigns.buttons[i]?.value || false}
                                label={assigns.buttons[i]?.label}
                                isAssigned={isAssigned}
                                onToggle={() => onToggleButton(i)}
                                onContextMenu={(e) => handleContextMenu(e, 'button', i)}
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