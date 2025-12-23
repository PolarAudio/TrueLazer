import React, { useState, useEffect, useRef } from 'react';
import Mappable from './Mappable';

const BPMControls = ({ bpm, onBpmChange }) => {
  const [tapTimes, setTapTimes] = useState([]);
  const [localBpm, setLocalBpm] = useState(bpm);

  useEffect(() => {
    setLocalBpm(bpm);
  }, [bpm]);

  const handleTap = () => {
    const now = Date.now();
    const newTapTimes = [...tapTimes, now].slice(-4);
    setTapTimes(newTapTimes);

    if (newTapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < newTapTimes.length; i++) {
        intervals.push(newTapTimes[i] - newTapTimes[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
      const tappedBpm = Math.round(60000 / avgInterval);
      onBpmChange(tappedBpm);
    }
  };

  const handleBpmInputChange = (e) => {
    const val = parseFloat(e.target.value);
    setLocalBpm(e.target.value); // Allow typing
    if (!isNaN(val) && val > 0 && val < 999) {
      onBpmChange(val);
    }
  };

  return (
    <div className="bpm-controls">
      <div className="bpm-display">
        <Mappable id="bpm_tap">
          <button className="bpm-tap-btn" onClick={handleTap}>TAP</button>
        </Mappable>
        <div className="bpm-fine-controls">
          <Mappable id="bpm_fine_down">
            <button className="bpm-fine-btn" onClick={() => onBpmChange(Math.max(1, bpm - 0.1))}>-</button>
          </Mappable>
          <Mappable id="bpm_value">
            <input 
              type="number" 
              className="bpm-input" 
              value={localBpm} 
              onChange={handleBpmInputChange}
              min="1"
              max="999"
              step="0.1"
            />
          </Mappable>
          <Mappable id="bpm_fine_up">
            <button className="bpm-fine-btn" onClick={() => onBpmChange(Math.min(999, bpm + 0.1))}>+</button>
          </Mappable>
        </div>
        <span className="bpm-label">BPM</span>
      </div>
    </div>
  );
};

export default BPMControls;