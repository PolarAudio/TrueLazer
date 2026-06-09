import React, { useEffect, useRef } from 'react';

const RadialKnob = ({ value, onChange, label, onDrop, size = 40, isAssigned, className: extraClassName, ...props }) => {
    const knobRef = useRef(null);
    const indicatorRef = useRef(null);
    const valueTextRef = useRef(null);
    const draggingValueRef = useRef(value);
    const isDraggingRef = useRef(false);

    // value 0-1
    const rotation = -135 + (value * 270);

    // Sync Ref with Prop when NOT dragging
    useEffect(() => {
        if (!isDraggingRef.current) {
            draggingValueRef.current = value;
            updateDOM(value);
        }
    }, [value]);

    const updateDOM = (val) => {
        const rot = -135 + (val * 270);
        if (indicatorRef.current) {
            indicatorRef.current.style.transform = `rotate(${rot}deg)`;
        }
        if (valueTextRef.current) {
            valueTextRef.current.innerText = `${Math.round(val * 100)}%`;
        }
    };

    const handleMouseDown = (e) => {
        if (!isAssigned || e.button !== 0) return;
        e.preventDefault();
        isDraggingRef.current = true;
        const startY = e.clientY;
        const startVal = draggingValueRef.current;
        
        const handleMouseMove = (ev) => {
            const delta = startY - ev.clientY;
            const change = delta / 200; // sensitivity
            const newVal = Math.max(0, Math.min(1, startVal + change));
            draggingValueRef.current = newVal;
            updateDOM(newVal);
            onChange(newVal);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleWheelLocal = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const change = e.deltaY * -0.01;
        const newVal = Math.max(0, Math.min(1, draggingValueRef.current + change));
        draggingValueRef.current = newVal;
        updateDOM(newVal);
        onChange(newVal);
    };

    useEffect(() => {
        const knobElement = knobRef.current;
        if (!knobElement) return;
        knobElement.addEventListener('wheel', handleWheelLocal, { passive: false });
        return () => knobElement.removeEventListener('wheel', handleWheelLocal);
    }, [onChange]); 

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
                const data = JSON.parse(rawData);
                if (data && (data.type === 'range' || data.type === 'number')) {
                    onDrop(data);
                }
            } catch (err) {
                console.error('[RadialKnob] Drop Error:', err);
            }
        }
    };

    return (
        <div className={`quick-assign-knob ${!isAssigned ? 'unassigned' : ''} ${extraClassName || ''}`.trim()}
             ref={knobRef}
             style={{ userSelect: 'none' }}
             onDragOver={handleDragOver} 
             onDrop={handleDrop}
             onMouseDown={handleMouseDown}
             {...props}
        >
		<div className="knob-label" title={label}>{label}</div>
			<div className="knob-circle" >
				<div className="knob-indicator" ref={indicatorRef} style={{ transform: `rotate(${rotation}deg)` }}></div>
			</div>
        
			<div className="knob-value" ref={valueTextRef} style={{ fontSize: '9px', color: '#888', marginTop: '2px' }}>{Math.round(value * 100)}%</div>
        </div>
    );
};

export default RadialKnob;