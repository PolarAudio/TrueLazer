import React, { useCallback } from 'react';
import Mappable from './Mappable';
import RadialKnob from './RadialKnob';

const QuickButton = ({ value, onToggle, label, onDrop, ...props }) => {
    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
    };

    const handleDrop = (e) => {
        e.preventDefault();
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/x-truelazer-param'));
            if (data && (data.type === 'toggle' || data.type === 'checkbox')) {
                onDrop(data);
            }
        } catch (err) {
            console.error('Invalid drop data', err);
        }
    };

    return (
        <div className={`quick-assign-button ${value ? 'active' : ''}`}
             onClick={onToggle}
             onDragOver={handleDragOver} 
             onDrop={handleDrop}
             {...props}
        >
            <div className="button-label" title={label || "Empty"}>{label || "Assign"}</div>
        </div>
    );
};

const GlobalQuickAssigns = ({ assigns, onUpdateKnob, onToggleButton, onAssign }) => {
    return (
        <div className="global-quick-assigns-panel">
            <div className="quick-assigns-row knobs-row">
                {Array.from({ length: 8 }).map((_, i) => (
                    <Mappable key={`knob-${i}`} id={`quick_knob_${i}`}>
                        <RadialKnob 
                            value={assigns.knobs[i]?.value || 0}
                            label={assigns.knobs[i]?.label}
                            onChange={(val) => onUpdateKnob(i, val)}
                            onDrop={(data) => onAssign('knob', i, data)}
                        />
                    </Mappable>
                ))}
            </div>
            <div className="quick-assigns-row buttons-row">
                {Array.from({ length: 8 }).map((_, i) => (
                    <Mappable key={`btn-${i}`} id={`quick_btn_${i}`}>
                        <QuickButton
                            value={assigns.buttons[i]?.value || false}
                            label={assigns.buttons[i]?.label}
                            onToggle={() => onToggleButton(i)}
                            onDrop={(data) => onAssign('button', i, data)}
                        />
                    </Mappable>
                ))}
            </div>
        </div>
    );
};

export default GlobalQuickAssigns;