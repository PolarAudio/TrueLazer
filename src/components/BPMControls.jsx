import React from 'react';

const BPMControls = ({ onPlay, onPause, onStop }) => (
  <div className="bpm-controls">
	<button className="speed-control-button" onClick={onPlay}>►</button>
    <button className="speed-control-button" onClick={onPause}>❚❚</button>
    <button className="speed-control-button" onClick={onStop}>■</button>
  </div>
);

export default BPMControls;