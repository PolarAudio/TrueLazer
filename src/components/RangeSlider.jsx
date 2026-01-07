import React, { useRef, useState, useEffect } from 'react';
import { resolveParam } from '../utils/effects';

const RangeSlider = ({ min, max, step, value, rangeValue, onChange, onRangeChange, showRange = false, disabled = false, animSettings, progressRef, workerId, clipDuration }) => {
    const trackRef = useRef(null);
    const valueHandleRef = useRef(null);
    const valueFillRef = useRef(null);
    const [dragging, setDragging] = useState(null); // 'min', 'max', 'value'

    const safeMin = min !== undefined ? min : 0;
    const safeMax = max !== undefined ? max : 1;

    // rangeValue is [low, high] for the animation bounds
    const currentRangeMin = rangeValue && rangeValue[0] !== undefined ? rangeValue[0] : safeMin;
    const currentRangeMax = rangeValue && rangeValue[1] !== undefined ? rangeValue[1] : safeMax;
    
    // value is the main current value (static)
    const currentValue = value !== undefined ? value : safeMin;

    const getPercentage = (val) => {
        const range = safeMax - safeMin;
        if (range === 0) return 0;
        return ((val - safeMin) / range) * 100;
    };

    // Animation Loop for Visual Feedback
    useEffect(() => {
        let animationFrameId;

        const updateVisuals = () => {
            if (dragging === 'value') {
                 // If dragging, visual is handled by state/props updates
                 animationFrameId = requestAnimationFrame(updateVisuals);
                 return;
            }

            let displayValue = currentValue;

            if (animSettings && animSettings.syncMode && progressRef && progressRef.current) {
                // Determine current progress
                const currentProgress = (workerId && progressRef.current[workerId] !== undefined) 
                    ? progressRef.current[workerId] 
                    : 0;
                
                const context = {
                    progress: currentProgress,
                    time: performance.now(),
                    clipDuration: clipDuration || 1
                };

                displayValue = resolveParam(null, currentValue, animSettings, context);
            }

            // Update DOM directly
            const pct = getPercentage(displayValue);
            if (valueHandleRef.current) {
                valueHandleRef.current.style.left = `${pct}%`;
            }
            if (valueFillRef.current) {
                valueFillRef.current.style.width = `${pct}%`;
            }

            animationFrameId = requestAnimationFrame(updateVisuals);
        };

        animationFrameId = requestAnimationFrame(updateVisuals);

        return () => cancelAnimationFrame(animationFrameId);
    }, [animSettings, progressRef, workerId, currentValue, dragging, safeMin, safeMax]);

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
            let newVal = safeMin + (percentage / 100) * (safeMax - safeMin);
            
            // Snap to step
            if (step) {
                newVal = Math.round(newVal / step) * step;
            }

            // Constraints
            // Value handle is constrained by safeMin/safeMax (track)
            // Range handles are constrained by each other and track
            
            if (handle === 'value') {
                newVal = Math.max(currentRangeMin, Math.min(currentRangeMax, newVal));
                onChange && onChange(newVal);
            } else if (handle === 'min') {
                newVal = Math.max(safeMin, Math.min(currentRangeMax, newVal)); // Can't cross max
                onRangeChange && onRangeChange([newVal, currentRangeMax]);
            } else if (handle === 'max') {
                newVal = Math.max(currentRangeMin, Math.min(safeMax, newVal)); // Can't cross min
                onRangeChange && onRangeChange([currentRangeMin, newVal]);
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
                
                {/* Range Fill (Visualizes the Animation Range) */}
                {showRange && (
                    <div 
                        className="range-slider-fill" 
                        style={{ 
                            position: 'absolute',
                            height: '100%',
                            background: 'var(--theme-color-transparent)',
                            left: `${getPercentage(currentRangeMin)}%`, 
                            width: `${getPercentage(currentRangeMax) - getPercentage(currentRangeMin)}%` 
                        }}
                    ></div>
                )}

                {/* Main Value Fill (from min to value, standard slider look, only if not showing range? Or always?) 
                    If showing range, maybe we don't show fill from 0? 
                    Let's show fill from min to value for standard look.
                */}
                {!showRange && (
                    <div 
                         className="value-slider-fill"
                         ref={valueFillRef}
                         style={{
                             position: 'absolute',
                             height: '100%',
                             background: 'var(--theme-color-transparent)',
                             left: '0%',
                             width: `${getPercentage(currentValue)}%`,
                             borderRadius: '2px'
                         }}
                    />
                )}


                {/* Min Handle (Range) */}
                {showRange && (
                    <div 
                        className="range-slider-handle min-handle" 
                        style={{ 
                            left: `${getPercentage(currentRangeMin)}%`
                        }}
                        onMouseDown={(e) => handleMouseDown(e, 'min')}
                        title={`Min: ${currentRangeMin.toFixed(2)}`}
                    ></div>
                )}

                {/* Max Handle (Range) */}
                {showRange && (
                    <div 
                        className="range-slider-handle max-handle" 
                        style={{ 
                            left: `${getPercentage(currentRangeMax)}%`
                        }}
                        onMouseDown={(e) => handleMouseDown(e, 'max')}
                        title={`Max: ${currentRangeMax.toFixed(2)}`}
                    ></div>
                )}

                {/* Main Value Handle */}
                <div 
                    className="range-slider-handle value-handle" 
                    ref={valueHandleRef}
                    style={{ 
                        left: `${getPercentage(currentValue)}%`,
                        position: 'absolute', width: '6px', height: '16px', top: '-50%', transform: 'translate(-50%, -25%)', cursor: 'pointer', zIndex: 20,
                        boxShadow: '0 0 2px rgba(0,0,0,0.5)'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'value')}
                    title={`Value: ${currentValue.toFixed(2)}`}
                ></div>

            </div>
        </div>
    );
};

export default RangeSlider;