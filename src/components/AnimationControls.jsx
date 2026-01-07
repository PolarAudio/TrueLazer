import React from 'react';

const AnimationControls = ({ animSettings, onChange }) => {
    const { 
        direction = 'forward', 
        style = 'loop', 
        syncMode = null,
        duration = 1,
        beats = 8,
        speedMultiplier = 1
    } = animSettings || {};

    const update = (key, val) => onChange({ ...animSettings, [key]: val });

    const adjustValue = (key, delta, isMultiply = false) => {
        let currentVal = animSettings?.[key] || (key === 'beats' ? 8 : 1);
        let newVal = currentVal;
        
        if (isMultiply) {
            newVal = delta > 1 ? newVal * 2 : newVal / 2;
        } else {
            newVal += delta;
        }
        
        if (newVal < 0.01) newVal = 0.01;
        // Round for float precision issues
        if (!isMultiply && key !== 'beats') newVal = Math.round(newVal * 100) / 100;
        
        update(key, newVal);
    };

    return (
        <div className="anim-controls-container">
            <div className="anim-row controls-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                     {/* Play Direction */}
                    <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                        <button className={`speed-control-button ${direction === 'backward' ? 'active' : ''}`} onClick={() => update('direction', 'backward')} title="Backward" style={{flex:1, padding:0, fontSize:'10px'}}>
                            <svg width="30" height="20" viewBox="0 0 24 24" data-name="Flat Color" className="icon flat-color" transform="scale(-1 1)">
								<path d="M17 2a1 1 0 0 0-1 1v7.08l-8.43-5.9a1 1 0 0 0-1-.07A1 1 0 0 0 6 5v14a1 1 0 0 0 .54.89A1 1 0 0 0 7 20a1 1 0 0 0 .57-.18l8.43-5.9V21a1 1 0 0 0 2 0V3a1 1 0 0 0-1-1" stroke="black"></path>
							</svg>
                        </button>
                        <button className={`speed-control-button ${direction === 'pause' ? 'active' : ''}`} onClick={() => update('direction', 'pause')} title="Pause" style={{flex:1, padding:0, fontSize:'10px'}}>
                            <svg width="25" height="20" viewBox="0 0 16 16" className="icon flat-color">
								<path d="M3 1h3c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1m7 0h3c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1m0 0"/>
							</svg>
                        </button>
                        <button className={`speed-control-button ${direction === 'forward' ? 'active' : ''}`} onClick={() => update('direction', 'forward')} title="Forward" style={{flex:1, padding:0, fontSize:'10px'}}>
                            <svg width="30" height="20" viewBox="0 0 24 24" data-name="Flat Color" className="icon flat-color">
								<path d="M17 2a1 1 0 0 0-1 1v7.08l-8.43-5.9a1 1 0 0 0-1-.07A1 1 0 0 0 6 5v14a1 1 0 0 0 .54.89A1 1 0 0 0 7 20a1 1 0 0 0 .57-.18l8.43-5.9V21a1 1 0 0 0 2 0V3a1 1 0 0 0-1-1" stroke="black"/>
							</svg>
                        </button>
                    </div>
                     {/* Play Style */}
                    <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                        <button className={`speed-control-button ${style === 'once' ? 'active' : ''}`} onClick={() => update('style', 'once')} title="Once" style={{flex:1, padding:0, fontSize:'10px'}}>
                            <svg width="30" height="20" viewBox="0 0 48 48" fill="none" className="icon two-color">
								<path d="M43.8233 25.2305C43.7019 25.9889 43.5195 26.727 43.2814 27.4395 42.763 28.9914 41.9801 30.4222 40.9863 31.6785 38.4222 34.9201 34.454 37 30 37H16C9.39697 37 4 31.6785 4 25 4 18.3502 9.39624 13 16 13L44 13" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M38 7 44 13 38 19" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M24 19V31" stroke="var(--theme-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M24 19 21 22 19.5 23.5" stroke="var(--theme-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
                        </button>
                        <button className={`speed-control-button ${style === 'bounce' ? 'active' : ''}`} onClick={() => update('style', 'bounce')} title="Bounce" style={{flex:1, padding:0, fontSize:'10px'}}>
							<svg width="30" height="20" viewBox="0 0 48 48" fill="none" className="icon two-color">
								<path d="M42 19H5.99998" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M30 7 42 19" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M6.79897 29H42.799" stroke="var(--theme-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M6.79895 29 18.799 41" stroke="var(--theme-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
                        </button>
                        <button className={`speed-control-button ${style === 'loop' ? 'active' : ''}`} onClick={() => update('style', 'loop')} title="Loop" style={{flex:1, padding:0, fontSize:'10px'}}>
                            <svg width="30" height="20" viewBox="0 0 48 48" fill="none" className="icon two-color">
								<path d="M4 25C4 18.3502 9.39624 13 16 13L44 13" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M38 7 44 13 38 19" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M44 23C44 29.6498 38.6038 35 32 35H4" stroke="var(--theme-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M10 41 4 35 10 29" stroke="var(--theme-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
                        </button>
                    </div>
                     {/* Sync Mode */}
                    <div className="btn-group" style={{display: 'flex', gap: '2px'}}>
                        <button className={`speed-control-button ${syncMode === 'fps' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'fps' ? null : 'fps')} style={{flex:1, padding:0, fontSize:'10px'}}>F</button>
                        <button className={`speed-control-button ${syncMode === 'timeline' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'timeline' ? null : 'timeline')} style={{flex:1, padding:0, fontSize:'10px'}}>T</button>
                        <button className={`speed-control-button ${syncMode === 'bpm' ? 'active' : ''}`} onClick={() => update('syncMode', syncMode === 'bpm' ? null : 'bpm')} style={{flex:1, padding:0, fontSize:'10px'}}>B</button>
                    </div>
            </div>

            {/* Submenus for Sync Modes */}
            {syncMode === 'timeline' && (
                <div className="anim-sub-settings" style={{ marginTop: '5px', padding: '2px', background: 'rgba(0,0,0,0.2)' }}>
                    <div className="control-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px' }}>
                        <label style={{color: '#aaa', marginRight: '5px'}}>Duration (s)</label>
                        <div className="value-adjuster" style={{ display: 'flex', gap: '2px' }}>
                            <button className="tiny-btn" onClick={() => adjustValue('duration', -1)}>-1</button>
                            <input 
                                type="number" 
                                value={typeof duration === 'number' ? duration.toFixed(2) : duration} 
                                onChange={(e) => update('duration', parseFloat(e.target.value) || 1)}
                                style={{ width: '40px', fontSize: '10px', textAlign: 'center', background: '#333', border: '1px solid #555', color: 'white' }}
                            />
                            <button className="tiny-btn" onClick={() => adjustValue('duration', 1)}>+1</button>
                            <button className="tiny-btn" onClick={() => adjustValue('duration', 0.5, true)}>/2</button>
                            <button className="tiny-btn" onClick={() => adjustValue('duration', 2, true)}>*2</button>
                        </div>
                    </div>
                </div>
            )}

            {syncMode === 'bpm' && (
                <div className="anim-sub-settings" style={{ marginTop: '5px', padding: '2px', background: 'rgba(0,0,0,0.2)' }}>
                    <div className="control-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px' }}>
                        <label style={{color: '#aaa', marginRight: '5px'}}>Beats</label>
                        <div className="value-adjuster" style={{ display: 'flex', gap: '2px' }}>
                            <button className="tiny-btn" onClick={() => adjustValue('beats', -1)}>-1</button>
                            <input 
                                type="number" 
                                value={beats} 
                                onChange={(e) => update('beats', parseInt(e.target.value) || 1)}
                                style={{ width: '40px', fontSize: '10px', textAlign: 'center', background: '#333', border: '1px solid #555', color: 'white' }}
                            />
                            <button className="tiny-btn" onClick={() => adjustValue('beats', 1)}>+1</button>
                            <button className="tiny-btn" onClick={() => adjustValue('beats', 0.5, true)}>/2</button>
                            <button className="tiny-btn" onClick={() => adjustValue('beats', 2, true)}>*2</button>
                        </div>
                    </div>
                </div>
            )}
            
            {(syncMode === 'timeline' || syncMode === 'bpm' || syncMode === 'fps') && (
                 <div className="anim-sub-settings" style={{ marginTop: '5px', padding: '2px', background: 'rgba(0,0,0,0.2)' }}>
                    <div className="control-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px' }}>
                        <label style={{color: '#aaa', marginRight: '5px'}}>Speed</label>
                        <div className="value-adjuster" style={{ display: 'flex', gap: '2px' }}>
                            <button className="tiny-btn" onClick={() => adjustValue('speedMultiplier', -0.1)}>-0.1</button>
                             <input 
                                type="number" 
                                value={typeof speedMultiplier === 'number' ? speedMultiplier.toFixed(2) : speedMultiplier} 
                                onChange={(e) => update('speedMultiplier', parseFloat(e.target.value) || 1)}
                                style={{ width: '40px', fontSize: '10px', textAlign: 'center', background: '#333', border: '1px solid #555', color: 'white' }}
                            />
                            <button className="tiny-btn" onClick={() => adjustValue('speedMultiplier', 0.1)}>+0.1</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AnimationControls;