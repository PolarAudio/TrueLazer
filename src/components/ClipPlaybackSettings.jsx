import React from 'react';
import CollapsiblePanel from './CollapsiblePanel';

const ClipPlaybackSettings = ({ settings, onUpdate }) => {
  const { mode = 'fps', duration = 1, beats = 8, speedMultiplier = 1, fps = 60 } = settings || {};

  const handleModeChange = (newMode) => {
    onUpdate({ mode: newMode });
  };

  const adjustValue = (key, delta, isMultiply = false) => {
    let newVal = settings[key] || (key === 'beats' ? 8 : (key === 'fps' ? 60 : 1));
    if (isMultiply) {
      newVal = delta > 1 ? newVal * 2 : newVal / 2;
    } else {
      newVal += delta;
    }
    if (newVal < 0.01) newVal = 0.01;
    onUpdate({ [key]: newVal });
  };

  return (
    <CollapsiblePanel title="Clip Playback">
        <div className="playback-mode-selector">
          <button 
              className={mode === 'fps' ? 'active' : 'button_inactive'} 
              onClick={() => handleModeChange('fps')}
          >FPS</button>
          <button 
              className={mode === 'timeline' ? 'active' : 'button_inactive'} 
              onClick={() => handleModeChange('timeline')}
          >Timeline</button>
          <button 
              className={mode === 'bpm' ? 'active' : 'button_inactive'}
              onClick={() => handleModeChange('bpm')}
          >BPM Sync</button>
        </div>

        <div className="playback-controls">
          {mode === 'fps' && (
            <>
              <div className="control-group">
                <label>Speed (FPS)</label>
                <div className="value-adjuster">
                  <button onClick={() => adjustValue('fps', -1)}>-1</button>
                  <input 
                    type="number" 
                    value={fps} 
                    onChange={(e) => onUpdate({ fps: parseInt(e.target.value) || 60 })}
                  />
                  <button onClick={() => adjustValue('fps', 1)}>+1</button>
                  <button onClick={() => adjustValue('fps', 0.5, true)}>/2</button>
                  <button onClick={() => adjustValue('fps', 2, true)}>*2</button>
                </div>
              </div>
              <div className="control-group">
                <label>Duration (s) (for effects)</label>
                <div className="value-adjuster">
                  <input 
                    type="number" 
                    value={duration.toFixed(2)} 
                    onChange={(e) => onUpdate({ duration: parseFloat(e.target.value) || 1 })}
                  />
                </div>
              </div>
            </>
          )}

          {mode === 'timeline' && (
            <div className="control-group">
              <label>Duration (s)</label>
              <div className="value-adjuster">
                <button onClick={() => adjustValue('duration', -1)}>-1</button>
                <input 
                  type="number" 
                  value={duration.toFixed(2)} 
                  onChange={(e) => onUpdate({ duration: parseFloat(e.target.value) || 1 })}
                />
                <button onClick={() => adjustValue('duration', 1)}>+1</button>
                <button onClick={() => adjustValue('duration', 0.5, true)}>/2</button>
                <button onClick={() => adjustValue('duration', 2, true)}>*2</button>
              </div>
            </div>
          )}

          {mode === 'bpm' && (
            <div className="control-group">
              <label>Beats</label>
              <div className="value-adjuster">
                <button onClick={() => adjustValue('beats', -1)}>-1</button>
                <input 
                  type="number" 
                  value={beats} 
                  onChange={(e) => onUpdate({ beats: parseInt(e.target.value) || 1 })}
                />
                <button onClick={() => adjustValue('beats', 1)}>+1</button>
                <button onClick={() => adjustValue('beats', 0.5, true)}>/2</button>
                <button onClick={() => adjustValue('beats', 2, true)}>*2</button>
              </div>
            </div>
          )}

          {(mode === 'timeline' || mode === 'bpm') && (
              <div className="control-group">
                  <label>Speed Multiplier</label>
                  <div className="value-adjuster">
                      <button onClick={() => adjustValue('speedMultiplier', -0.1)}>-0.1</button>
                      <input 
                          type="number" 
                          value={speedMultiplier.toFixed(2)} 
                          onChange={(e) => onUpdate({ speedMultiplier: parseFloat(e.target.value) || 1 })}
                      />
                      <button onClick={() => adjustValue('speedMultiplier', 0.1)}>+0.1</button>
                  </div>
              </div>
          )}
        </div>
    </CollapsiblePanel>
  );
};

export default ClipPlaybackSettings;
