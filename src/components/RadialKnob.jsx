import React, { useEffect, useRef } from 'react';

const RadialKnob = ({ value, onChange, label, onDrop, size = 40, ...props }) => {
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
                const data = JSON.parse(e.dataTransfer.getData('application/x-truelazer-param'));
                if (data && data.type === 'range') {
                    onDrop(data);
                }
            } catch (err) {
                console.error('Invalid drop data', err);
            }
        }
    };

    // value 0-1
    const rotation = -135 + (value * 270);

    const handleMouseDown = (e) => {
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
    }, [value, onChange]); 

    return (
        <div className="quick-assign-knob" 
             ref={knobRef}
             style={{ width: size, cursor: 'ns-resize', userSelect: 'none' }}
             onDragOver={handleDragOver} 
             onDrop={handleDrop}
             onMouseDown={handleMouseDown}
             {...props}
        >
            <div className="knob-circle" style={{ width: size*0.66, height: size*0.66 }}>
                <div className="knob-indicator" style={{ transform: `rotate(${rotation}deg)` }}></div>
            </div>
            {label && <div className="knob-label" title={label}>{label}</div>}
        </div>
    );
};

export default RadialKnob;