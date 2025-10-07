import React from 'react';

const BPMControls = ({ onPlay, onPause, onStop }) => (
  <div className="bpm-controls">
	<span className="layer-control-button"><button onClick={onPlay}>Play</button></span>
    <span className="layer-control-button"><button onClick={onPause}>Pause</button></span>
    <span className="layer-control-button"><button onClick={onStop}>Stop</button></span>
  </div>
);

export default BPMControls;