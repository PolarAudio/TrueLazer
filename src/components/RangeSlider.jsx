import React, { useRef, useState, useEffect } from 'react';
import { resolveParam } from '../utils/effects';

const RangeSlider = ({ min, max, step, value, rangeValue, onChange, onRangeChange, showRange = false, disabled = false, animSettings, progressRef, workerId, clipDuration, bpm, getFftLevels }) => {
    const trackRef = useRef(null);
    const valueHandleRef = useRef(null);
    const valueFillRef = useRef(null);
    const [dragging, setDragging] = useState(null); // 'min', 'max', 'value'
    const [hoveredHandle, setHoveredHandle] = useState(null);

    const safeMin = min !== undefined ? min : 0;
    const safeMax = max !== undefined ? max : 1;

    // ... exists ...

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
                {(dragging === 'min' || hoveredHandle === 'min') && renderTooltip(currentRangeMin, getPercentage(currentRangeMin))}
                {(dragging === 'max' || hoveredHandle === 'max') && renderTooltip(currentRangeMax, getPercentage(currentRangeMax))}
                {(dragging === 'value' || hoveredHandle === 'value') && renderTooltip(currentValue, getPercentage(currentValue))}

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
                             // Remove width from here to prevent React fighting
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
                        onMouseEnter={() => setHoveredHandle('min')}
                        onMouseLeave={() => setHoveredHandle(null)}
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