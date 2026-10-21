import React, { useState, useEffect, useRef } from 'react';
import Mappable from './Mappable';

const BPMControls = ({ bpm, onBpmChange, onTap, bpmSource = 'tap', onBpmSourceChange }) => {
  const [localBpm, setLocalBpm] = useState(bpm);

  useEffect(() => {
    setLocalBpm(bpm);
  }, [bpm]);

  const handleTap = () => {
    if (onTap) onTap();
  };

  const handleBpmInputChange = (e) => {
    const val = parseFloat(e.target.value);
    setLocalBpm(e.target.value);
    if (!isNaN(val) && val > 0 && val < 999) {
      onBpmChange(val);
    }
  };

  const bpmInputRef = useRef(null);
  useEffect(() => {
    const el = bpmInputRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      const newVal = Math.round(Math.max(1, Math.min(999, bpm + delta)));
      setLocalBpm(newVal);
      onBpmChange(newVal);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [bpm, onBpmChange]);

  const handleBpmSourceChange = () => {
    if (onBpmSourceChange) {
      if (bpmSource === 'tap') onBpmSourceChange('tcnet');
      else if (bpmSource === 'tcnet') onBpmSourceChange('prolink');
      else if (bpmSource === 'prolink') onBpmSourceChange('stagelinq');
      else if (bpmSource === 'stagelinq') onBpmSourceChange('tap');
    }
  };

  // Tap tempo and the +/- nudge only make sense when the BPM is ours to set.
  // On a sync source the deck drives the value, so those controls are removed
  // outright and the number stays as a read-only readout of the incoming BPM.
  const isTapMode = bpmSource === 'tap';
  const sourceLabel = bpmSource === 'prolink' ? 'ProDJ Link' : bpmSource === 'stagelinq' ? 'StageLinq' : bpmSource === 'tcnet' ? 'TCNet' : null;

  return (
    <div className="bpm-controls">
      <div className="bpm-display">
        <button
          className={`bpm-source-toggle ${bpmSource === 'tcnet' ? 'active' : ''}`}
          onClick={handleBpmSourceChange}
          title="Switch BPM source: manual TapTempo vs TCNet Beat Grid vs ProDJ Link vs StageLinq"
        >
          {bpmSource === 'prolink' ? 'ProDJ' : bpmSource === 'tcnet' ? 'TCNet' : bpmSource === 'stagelinq' ? 'StLq' : 'Tap'}
        </button>
        {isTapMode && (
          <Mappable id="bpm_tap">
            <button className="bpm-tap-btn" onClick={handleTap} title="Tap to set BPM">TAP</button>
          </Mappable>
        )}
        <div className="bpm-fine-controls">
          {isTapMode && (
            <Mappable id="bpm_fine_down">
              <button className="bpm-fine-btn" onClick={() => onBpmChange(Math.max(1, bpm - 0.1))}>-</button>
            </Mappable>
          )}
          <Mappable id="bpm_value">
            <input
              type="number"
              className="bpm-input"
              value={localBpm}
              onChange={handleBpmInputChange}
              min="1"
              max="999"
              step="0.1"
              ref={bpmInputRef}
              disabled={!isTapMode}
              title={sourceLabel ? `BPM is driven by ${sourceLabel}` : 'Show BPM'}
            />
          </Mappable>
          {isTapMode && (
            <Mappable id="bpm_fine_up">
              <button className="bpm-fine-btn" onClick={() => onBpmChange(Math.min(999, bpm + 0.1))}>+</button>
            </Mappable>
          )}
        </div>
        <span className="bpm-label">BPM</span>
      </div>
    </div>
  );
};

export default BPMControls;
