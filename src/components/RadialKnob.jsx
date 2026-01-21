import React, { useEffect, useRef } from 'react';

const RadialKnob = ({ value, onChange, label, onDrop, size = 40, isAssigned, ...props }) => {
    const knobRef = useRef(null);

    const handleDragOver = (e) => {
        if (onDrop) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
        }
    };

    const handleDrop = (e) => {
        if (onDrop) {
            e.preventDefault();
            try {
                const rawData = e.dataTransfer.getData('application/x-truelazer-param');
                console.log('[RadialKnob] Dropped Data Raw:', rawData);
                const data = JSON.parse(rawData);
                console.log('[RadialKnob] Dropped Data Parsed:', data);

                if (data && (data.type === 'range' || data.type === 'number')) {
                    onDrop(data);
                } else {
                    console.warn('[RadialKnob] Invalid data type for knob:', data?.type);
                }
            } catch (err) {
                console.error('[RadialKnob] Drop Error:', err);
            }
        }
    };

    // value 0-1
    const rotation = -135 + (value * 270);

    const handleMouseDown = (e) => {
        if (!isAssigned) return;
        e.preventDefault(); // Prevent text selection
        const startY = e.clientY;
        const startVal = value;
        
        const handleMouseMove = (ev) => {
            const delta = startY - ev.clientY;
            const change = delta / 200; // sensitivity
            let newVal = Math.max(0, Math.min(1, startVal + change));
            onChange(newVal);
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    useEffect(() => {
        const knobElement = knobRef.current;
        if (!knobElement) return;

        const handleWheel = (e) => {
            if (!isAssigned) return;
            e.preventDefault();
            e.stopPropagation();
            const change = e.deltaY * -0.001; // Negative deltaY is scrolling up
            let newVal = Math.max(0, Math.min(1, value + change));
            onChange(newVal);
        };

        knobElement.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            knobElement.removeEventListener('wheel', handleWheel);
        };
    }, [value, onChange, isAssigned]); 

    return (
        <div className={`quick-assign-knob ${!isAssigned ? 'unassigned' : ''}`}
             ref={knobRef}
             style={{ width: size, cursor: isAssigned ? 'ns-resize' : 'default', userSelect: 'none', opacity: isAssigned ? 1 : 0.5 }}
             onDragOver={handleDragOver} 
             onDrop={handleDrop}
             onMouseDown={handleMouseDown}
             {...props}
        >
            <div className="knob-circle" style={{ width: size*0.66, height: size*0.66 }}>
                <div className="knob-indicator" style={{ transform: `rotate(${rotation}deg)` }}></div>
            </div>
            {label && <div className="knob-label" title={label}>{label}</div>}
            <div className="knob-value" style={{ fontSize: '9px', color: '#888', marginTop: '2px' }}>{Math.round(value * 100)}%</div>
        </div>
    );
};

export default RadialKnob;