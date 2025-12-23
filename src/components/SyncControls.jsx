import React from 'react';

const SyncControls = ({ paramId, currentSyncMode, onSetSyncMode }) => {
  return (
    <div className="sync-controls">
      <button 
        className={`sync-btn ${currentSyncMode === 'fps' ? 'active' : ''}`}
        onClick={() => onSetSyncMode(paramId, 'fps')}
        title="Sync to Global FPS"
      >F</button>
      <button 
        className={`sync-btn ${currentSyncMode === 'timeline' ? 'active' : ''}`}
        onClick={() => onSetSyncMode(paramId, 'timeline')}
        title="Sync to Timeline"
      >T</button>
      <button 
        className={`sync-btn ${currentSyncMode === 'bpm' ? 'active' : ''}`}
        onClick={() => onSetSyncMode(paramId, 'bpm')}
        title="Sync to BPM"
      >B</button>
    </div>
  );
};

export default SyncControls;
