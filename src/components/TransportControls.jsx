import React from 'react';
import Mappable from './Mappable';

const TransportControls = ({ onPlay, onPause, onStop, isPlaying, isStopped }) => {
  return (
    <div className="transport-controls">
      <Mappable id="transport_play">
        <button className={`speed-control-button ${isPlaying ? 'active' : ''}`} onClick={onPlay}>►</button>
      </Mappable>
      <Mappable id="transport_pause">
        <button className={`speed-control-button ${(!isPlaying && !isStopped) ? 'active' : ''}`} onClick={onPause}>❚❚</button>
      </Mappable>
      <Mappable id="transport_stop">
        <button className={`speed-control-button ${isStopped ? 'active' : ''}`} onClick={onStop}>■</button>
      </Mappable>
    </div>
  );
};

export default TransportControls;
