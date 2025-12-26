import React, { useRef, useState, useEffect } from 'react';

const RangeSlider = ({ min, max, step, value, onChange }) => {
    const trackRef = useRef(null);
    const [dragging, setDragging] = useState(null); // 'min', 'max'

    const safeMin = min !== undefined ? min : 0;
    const safeMax = max !== undefined ? max : 1;

    const currentMin = value && value[0] !== undefined ? value[0] : safeMin;
    const currentMax = value && value[1] !== undefined ? value[1] : safeMax;

    const getPercentage = (val) => {
        const range = safeMax - safeMin;
        if (range === 0) return 0;
        return ((val - safeMin) / range) * 100;
    };

    const handleMouseDown = (e, handle) => {
        e.preventDefault();
        setDragging(handle);
        
        const handleMouseMove = (ev) => {
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const rawX = ev.clientX - rect.left;
            let percentage = Math.max(0, Math.min(100, (rawX / rect.width) * 100));
            let newVal = safeMin + (percentage / 100) * (safeMax - safeMin);
            
            // Snap to step
            if (step) {
                newVal = Math.round(newVal / step) * step;
            }

            // Ensure constraints
            if (handle === 'min') {
                newVal = Math.min(newVal, currentMax);
                onChange([newVal, currentMax]);
            } else {
                newVal = Math.max(newVal, currentMin);
                onChange([currentMin, newVal]);
            }
        };

        const handleMouseUp = () => {
            setDragging(null);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div className="range-slider-container">
            <div className="range-slider-track" ref={trackRef}>
                <div 
                    className="range-slider-fill" 
                    style={{ 
                        left: `${getPercentage(currentMin)}%`, 
                        width: `${getPercentage(currentMax) - getPercentage(currentMin)}%` 
                    }}
                ></div>
                <div 
                    className="range-slider-handle min-handle" 
                    style={{ left: `${getPercentage(currentMin)}%` }}
                    onMouseDown={(e) => handleMouseDown(e, 'min')}
                ></div>
                <div 
                    className="range-slider-handle max-handle" 
                    style={{ left: `${getPercentage(currentMax)}%` }}
                    onMouseDown={(e) => handleMouseDown(e, 'max')}
                ></div>
            </div>
            <div className="range-slider-values">
                <span>{typeof currentMin === 'number' ? currentMin.toFixed(2) : '0.00'}</span>
                <span>{typeof currentMax === 'number' ? currentMax.toFixed(2) : '0.00'}</span>
            </div>
        </div>
    );
};

export default RangeSlider;