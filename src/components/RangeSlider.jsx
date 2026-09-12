import React, { useRef, useState, useEffect } from 'react';
import { resolveParam } from '../utils/effects';

const RangeSlider = ({ min, max, step, value, rangeValue, onChange, onRangeChange, showRange = false, disabled = false, animSettings, progressRef, workerId, clipDuration, bpm, getFftLevels }) => {
    const trackRef = useRef(null);
    const valueHandleRef = useRef(null);
    const valueFillRef = useRef(null);
    const rangeFillRef = useRef(null);
    const minHandleRef = useRef(null);
    const maxHandleRef = useRef(null);
    const [dragging, setDragging] = useState(null); // 'min', 'max', 'value'
    const [hoveredHandle, setHoveredHandle] = useState(null);
    const draggingValueRef = useRef(value); // Keep track of latest drag value

    const safeMin = min !== undefined ? min : 0;
    const safeMax = max !== undefined ? max : 1;

    // rangeValue is [low, high] for the animation bounds
    const currentRangeMin = rangeValue && rangeValue[0] !== undefined ? rangeValue[0] : safeMin;
    const currentRangeMax = rangeValue && rangeValue[1] !== undefined ? rangeValue[1] : safeMax;
    
    // value is the main current value (static)
    const currentValue = value !== undefined ? value : safeMin;

    // Live range ref: read during drags so the ghost tracks the mouse without
    // re-renders; synced back to props whenever the range handles aren't being dragged.
    const rangeValueRef = useRef([currentRangeMin, currentRangeMax]);
    const liveRange = (rangeValueRef.current && rangeValueRef.current[0] !== undefined) ? rangeValueRef.current : [currentRangeMin, currentRangeMax];

    // Sync Ref with Prop when NOT dragging
    useEffect(() => {
        if (dragging !== 'value') {
            draggingValueRef.current = value;
        }
    }, [value, dragging]);

    // Sync Range Ref with Prop when NOT dragging the range handles
    useEffect(() => {
        if (dragging !== 'min' && dragging !== 'max') {
            rangeValueRef.current = [currentRangeMin, currentRangeMax];
        }
    }, [currentRangeMin, currentRangeMax, dragging]);

    const getPercentage = (val) => {
        const range = safeMax - safeMin;
        if (range === 0) return 0;
        return ((val - safeMin) / range) * 100;
    };

    // Animation Loop for Visual Feedback
    useEffect(() => {
        let animationFrameId;

        const updateVisuals = () => {
            let displayValue = currentValue;
            const currentRange = rangeValueRef.current;
            const rangeMin = currentRange[0];
            const rangeMax = currentRange[1];

            if (dragging === 'value') {
                 displayValue = draggingValueRef.current;
            } else if (animSettings && animSettings.syncMode && progressRef && progressRef.current) {
                // A live progress value exists only while the owning clip is
                // actually rendering (active/playing). timeline/bpm syncing
                // depends on that stream; fps flips on wall-clock time alone.
                const hasLiveProgress = workerId && progressRef.current[workerId] !== undefined;
                const currentProgress = hasLiveProgress ? progressRef.current[workerId] : 0;

                const context = {
                    progress: currentProgress,
                    time: performance.now(),
                    clipDuration: clipDuration || 1,
                    bpm: bpm || 120,
                    fftLevels: getFftLevels ? getFftLevels() : { low: 0, mid: 0, high: 0 }
                };

                if (animSettings.syncMode === 'fps' || hasLiveProgress) {
                    displayValue = resolveParam(null, currentValue, { ...animSettings, range: [rangeMin, rangeMax] }, context, safeMin, safeMax);
                }
                // else: timeline/bpm demand live progress to animate — but the
                // clip isn't rendering right now, so the base value is shown
                // instead of freezing the handle at progress-0's range snap.
            }

            // Update DOM directly
            const pct = getPercentage(displayValue);
            if (valueHandleRef.current) {
                valueHandleRef.current.style.left = `${pct}%`;
            }
            if (valueFillRef.current) {
                valueFillRef.current.style.width = `${pct}%`;
            }

            // Range ghost visuals (only present when showRange)
            const rangeMinPct = getPercentage(rangeMin);
            const rangeMaxPct = getPercentage(rangeMax);
            if (rangeFillRef.current) {
                rangeFillRef.current.style.left = `${rangeMinPct}%`;
                rangeFillRef.current.style.width = `${rangeMaxPct - rangeMinPct}%`;
            }
            if (minHandleRef.current) minHandleRef.current.style.left = `${rangeMinPct}%`;
            if (maxHandleRef.current) maxHandleRef.current.style.left = `${rangeMaxPct}%`;

            animationFrameId = requestAnimationFrame(updateVisuals);
        };

        animationFrameId = requestAnimationFrame(updateVisuals);

        return () => cancelAnimationFrame(animationFrameId);
    }, [animSettings, progressRef, workerId, currentValue, dragging, safeMin, safeMax, bpm, getFftLevels, clipDuration]);

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
            const currentRange = rangeValueRef.current;
            const curRangeMin = currentRange[0];
            const curRangeMax = currentRange[1];
            
            // Snap to step
            if (step) {
                newVal = Math.round(newVal / step) * step;
                // Recalculate percentage for visual snap
                percentage = ((newVal - safeMin) / (safeMax - safeMin)) * 100;
            }

            // Constraints
            if (handle === 'value') {
                newVal = Math.max(curRangeMin, Math.min(curRangeMax, newVal));
                draggingValueRef.current = newVal;
                // Visual update is now handled by the animation loop reading from draggingValueRef
                onChange && onChange(newVal);
            } else if (handle === 'min') {
                newVal = Math.max(safeMin, Math.min(curRangeMax, newVal)); // Can't cross max
                currentRange[0] = newVal; // Ghost tracked by the animation loop (same array identity)
                onRangeChange && onRangeChange([newVal, curRangeMax]);
            } else if (handle === 'max') {
                newVal = Math.max(curRangeMin, Math.min(safeMax, newVal)); // Can't cross min
                currentRange[1] = newVal; // Ghost tracked by the animation loop (same array identity)
                onRangeChange && onRangeChange([curRangeMin, newVal]);
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

    const renderTooltip = (val, leftPct) => {
        return (
            <div 
                className="slider-tooltip"
                style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: `${leftPct}%`,
                    transform: 'translateX(-50%)',
                    background: '#222',
                    color: '#fff',
                    padding: '2px 5px',
                    borderRadius: '3px',
                    fontSize: '10px',
                    marginBottom: '8px',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    border: '1px solid #555',
                    zIndex: 100,
                    boxShadow: '0 2px 5px rgba(0,0,0,0.5)'
                }}
            >
                {val.toFixed(2)}
            </div>
        );
    };

    return (
        <div className="range-slider-container" style={{ position: 'relative', width: '100%', height: '20px', display: 'flex', alignItems: 'center' }}>
            <div className="range-slider-track" ref={trackRef} style={{ width: '100%', height: '4px', background: '#444', borderRadius: '2px', position: 'relative' }}>
                
                {/* Tooltips */}
                {(dragging === 'min' || hoveredHandle === 'min') && renderTooltip(liveRange[0], getPercentage(liveRange[0]))}
                {(dragging === 'max' || hoveredHandle === 'max') && renderTooltip(liveRange[1], getPercentage(liveRange[1]))}
                {(dragging === 'value' || hoveredHandle === 'value') && renderTooltip(dragging === 'value' ? draggingValueRef.current : currentValue, getPercentage(dragging === 'value' ? draggingValueRef.current : currentValue))}

                {/* Range Fill (Visualizes the Animation Range) */}
                {showRange && (
                    <div 
                        className="range-slider-fill" 
                        ref={rangeFillRef}
                        style={{ 
                            position: 'absolute',
                            height: '100%',
                            background: 'var(--theme-color-transparent)',
                            left: '0%',
                            width: '0%'
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
                             // Remove width from here to prevent React fighting
                             borderRadius: '2px'
                         }}
                    />
                )}


                {/* Min Handle (Range) */}
                {showRange && (
                    <div 
                        className="range-slider-handle min-handle" 
                        ref={minHandleRef}
                        style={{ 
                            left: '0%'
                        }}
                        onMouseDown={(e) => handleMouseDown(e, 'min')}
                        onMouseEnter={() => setHoveredHandle('min')}
                        onMouseLeave={() => setHoveredHandle(null)}
                        title={`Min: ${currentRangeMin.toFixed(2)}`}
                    ></div>
                )}

                {/* Max Handle (Range) */}
                {showRange && (
                    <div 
                        className="range-slider-handle max-handle" 
                        ref={maxHandleRef}
                        style={{ 
                            left: '0%'
                        }}
                        onMouseDown={(e) => handleMouseDown(e, 'max')}
                        onMouseEnter={() => setHoveredHandle('max')}
                        onMouseLeave={() => setHoveredHandle(null)}
                        title={`Max: ${currentRangeMax.toFixed(2)}`}
                    ></div>
                )}

                {/* Main Value Handle */}
                <div 
                    className="range-slider-handle value-handle" 
                    ref={valueHandleRef}
                    style={{ 
                        // Remove left from here to prevent React fighting
                        position: 'absolute', width: '6px', height: '16px', top: '-50%', transform: 'translate(-50%, -25%)', cursor: 'pointer', zIndex: 20,
                        boxShadow: '0 0 2px rgba(0,0,0,0.5)'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'value')}
                    onMouseEnter={() => setHoveredHandle('value')}
                    onMouseLeave={() => setHoveredHandle(null)}
                    title={`Value: ${currentValue.toFixed(2)}`}
                ></div>

            </div>
        </div>
    );
};

export default RangeSlider;