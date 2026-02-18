import React, { useRef, useState, useEffect, useCallback } from 'react';

const DualRangeSlider = ({ min = 0, max = 1, step = 0.01, value = [0, 1], onChange, disabled = false }) => {
    const trackRef = useRef(null);
    const [dragging, setDragging] = useState(null); // 'low', 'high'

    const lowValue = value[0] !== undefined ? value[0] : min;
    const highValue = value[1] !== undefined ? value[1] : max;

    const getPercentage = useCallback((val) => {
        const range = max - min;
        if (range === 0) return 0;
        return ((val - min) / range) * 100;
    }, [min, max]);

    const handleMouseDown = (e, handle) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(handle);
        
        const handleMouseMove = (ev) => {
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const rawX = ev.clientX - rect.left;
            let percentage = Math.max(0, Math.min(100, (rawX / rect.width) * 100));
            let newVal = min + (percentage / 100) * (max - min);
            
            if (step) {
                newVal = Math.round(newVal / step) * step;
            }

            if (handle === 'low') {
                const nextLow = Math.min(newVal, highValue - step);
                onChange && onChange([nextLow, highValue]);
            } else {
                const nextHigh = Math.max(newVal, lowValue + step);
                onChange && onChange([lowValue, nextHigh]);
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
        <div className="range-slider-container" style={{ position: 'relative', width: '100%', height: '20px', display: 'flex', alignItems: 'center' }}>
            <div className="range-slider-track" ref={trackRef} style={{ width: '100%', height: '4px', background: '#444', borderRadius: '2px', position: 'relative' }}>
                
                {/* Active Range Fill */}
                <div 
                    className="range-slider-fill" 
                    style={{ 
                        position: 'absolute',
                        height: '100%',
                        background: 'var(--theme-color)',
                        left: `${getPercentage(lowValue)}%`, 
                        width: `${getPercentage(highValue) - getPercentage(lowValue)}%` 
                    }}
                ></div>

                {/* Low Handle */}
                <div 
                    className="range-slider-handle" 
                    style={{ 
                        left: `${getPercentage(lowValue)}%`,
                        position: 'absolute', width: '10px', height: '10px', borderRadius: '50%', background: '#fff', top: '50%', transform: 'translate(-50%, -50%)', cursor: 'pointer', zIndex: 20
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'low')}
                    title={`Low: ${lowValue.toFixed(2)}`}
                ></div>

                {/* High Handle */}
                <div 
                    className="range-slider-handle" 
                    style={{ 
                        left: `${getPercentage(highValue)}%`,
                        position: 'absolute', width: '10px', height: '10px', borderRadius: '50%', background: '#fff', top: '50%', transform: 'translate(-50%, -50%)', cursor: 'pointer', zIndex: 20
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'high')}
                    title={`High: ${highValue.toFixed(2)}`}
                ></div>
            </div>
        </div>
    );
};

export default DualRangeSlider;
