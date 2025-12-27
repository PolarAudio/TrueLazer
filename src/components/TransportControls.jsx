import React from 'react';
import Mappable from './Mappable';

const TransportControls = ({ onPlay, onPause, onStop, isPlaying, isStopped }) => {
  const handleDragStart = (e, command) => {
    e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
        type: 'toggle',
        paramName: command,
        targetType: 'transport',
        label: command.toUpperCase()
    }));
  };

  return (
    <div className="transport-controls">
      <Mappable id="transport_play">
        <button 
            className={`speed-control-button ${isPlaying ? 'active' : ''}`} 
            onClick={onPlay}
            draggable
            onDragStart={(e) => handleDragStart(e, 'play')}
        >
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-play-fill" viewBox="0 0 16 16">
				<path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>
			</svg>
		</button>
      </Mappable>
      <Mappable id="transport_pause">
        <button 
            className={`speed-control-button ${(!isPlaying && !isStopped) ? 'active' : ''}`} 
            onClick={onPause}
            draggable
            onDragStart={(e) => handleDragStart(e, 'pause')}
        >
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-pause-fill" viewBox="0 0 16 16">
				<path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
			</svg>
		</button>
      </Mappable>
      <Mappable id="transport_stop">
        <button 
            className={`speed-control-button ${isStopped ? 'active' : ''}`} 
            onClick={onStop}
            draggable
            onDragStart={(e) => handleDragStart(e, 'stop')}
        >
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-stop-fill" viewBox="0 0 16 16">
				<path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5"/>
			</svg>
		</button>
      </Mappable>
    </div>
  );
};

export default TransportControls;
