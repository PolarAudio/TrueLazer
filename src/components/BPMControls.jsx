import React from 'react';
import Mappable from './Mappable';

const BPMControls = ({ onPlay, onPause, onStop }) => (
  <div className="bpm-controls">
    <Mappable id="transport_play">
	    <button className="speed-control-button" onClick={onPlay}>►</button>
    </Mappable>
    <Mappable id="transport_pause">
      <button className="speed-control-button" onClick={onPause}>❚❚</button>
    </Mappable>
    <Mappable id="transport_stop">
      <button className="speed-control-button" onClick={onStop}>■</button>
    </Mappable>
  </div>
);

export default BPMControls;