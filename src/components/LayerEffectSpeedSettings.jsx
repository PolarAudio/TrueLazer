import React from 'react';
import CollapsiblePanel from './CollapsiblePanel';

const LayerEffectSpeedSettings = ({ enabled, settings, globalBpm, globalFps, onToggle, onUpdate, uiState, onUpdateUiState }) => {
  const s = {
    mode: 'fps',
    beats: 8,
    duration: 1,
    speedMultiplier: 1,
    ...(settings || {})
  };

  const collapsedPanels = uiState?.collapsedPanels || {};

  const handleToggle = (val) => {
    if (onUpdateUiState) {
      onUpdateUiState({
        collapsedPanels: {
          effectSpeed: val
        }
      });
    }
  };

  const adjustValue = (key, delta, isMultiply = false) => {
    let newVal = s[key] || (key === 'beats' ? 8 : 1);
    if (isMultiply) {
      newVal = delta > 1 ? newVal * 2 : newVal / 2;
    } else {
      newVal += delta;
    }
    if (newVal < 0.01) newVal = 0.01;
    onUpdate({ [key]: newVal });
  };

  return (
    <CollapsiblePanel
      title="Effect Speed Control"
      isCollapsed={!!collapsedPanels['effectSpeed']}
      onToggle={handleToggle}
    >
      <div className="param-editor">
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          Speed-match layer effects independently of clip playback
        </label>
      </div>

      {enabled && (
        <div className="clip-playback-settings">
          <div className="playback-mode-selector">
            <button
              className={s.mode === 'fps' ? 'active' : 'button_inactive'}
              onClick={() => onUpdate({ mode: 'fps' })}
            >FPS</button>
            <button
              className={s.mode === 'timeline' ? 'active' : 'button_inactive'}
              onClick={() => onUpdate({ mode: 'timeline' })}
            >Timeline</button>
            <button
              className={s.mode === 'bpm' ? 'active' : 'button_inactive'}
              onClick={() => onUpdate({ mode: 'bpm' })}
            >BPM Sync</button>
          </div>

          <div className="playback-controls">
            {s.mode === 'fps' && (
              <div className="control-group">
                <label>FPS Target (from Global FPS)</label>
                <div className="value-adjuster" style={{ opacity: 0.7 }}>
                  <input type="number" value={globalFps} readOnly disabled />
                </div>
              </div>
            )}

            {s.mode === 'timeline' && (
              <div className="control-group">
                <label>Duration (s)</label>
                <div className="value-adjuster">
                  <button onClick={() => adjustValue('duration', -1)}>-1</button>
                  <input
                    type="number"
                    value={s.duration.toFixed(2)}
                    onChange={(e) => onUpdate({ duration: parseFloat(e.target.value) || 1 })}
                  />
                  <button onClick={() => adjustValue('duration', 1)}>+1</button>
                  <button onClick={() => adjustValue('duration', 0.5, true)}>/2</button>
                  <button onClick={() => adjustValue('duration', 2, true)}>*2</button>
                </div>
              </div>
            )}

            {s.mode === 'bpm' && (
              <>
                <div className="control-group">
                  <label>Global BPM (from Master BPM)</label>
                  <div className="value-adjuster" style={{ opacity: 0.7 }}>
                    <input type="number" value={globalBpm} readOnly disabled />
                  </div>
                </div>
                <div className="control-group">
                  <label>Beats</label>
                  <div className="value-adjuster">
                    <button onClick={() => adjustValue('beats', -1)}>-1</button>
                    <input
                      type="number"
                      value={s.beats}
                      onChange={(e) => onUpdate({ beats: parseInt(e.target.value) || 1 })}
                    />
                    <button onClick={() => adjustValue('beats', 1)}>+1</button>
                    <button onClick={() => adjustValue('beats', 0.5, true)}>/2</button>
                    <button onClick={() => adjustValue('beats', 2, true)}>*2</button>
                  </div>
                </div>
              </>
            )}

            {(s.mode === 'timeline' || s.mode === 'bpm') && (
              <div className="control-group">
                <label>Speed Multiplier</label>
                <div className="value-adjuster">
                  <button onClick={() => adjustValue('speedMultiplier', -0.1)}>-0.1</button>
                  <input
                    type="number"
                    value={s.speedMultiplier.toFixed(2)}
                    onChange={(e) => onUpdate({ speedMultiplier: parseFloat(e.target.value) || 1 })}
                  />
                  <button onClick={() => adjustValue('speedMultiplier', 0.1)}>+0.1</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </CollapsiblePanel>
  );
};

export default LayerEffectSpeedSettings;