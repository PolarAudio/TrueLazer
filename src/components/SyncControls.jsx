import React from 'react';
import { useTranslation } from '../i18n';

const SyncControls = ({ paramId, currentSyncMode, onSetSyncMode }) => {
  const { t } = useTranslation();
  return (
    <div className="sync-controls">
      <button 
        className={`sync-btn ${currentSyncMode === 'fps' ? 'active' : ''}`}
        onClick={() => onSetSyncMode(paramId, 'fps')}
        title={t('sync.toGlobalFps')}
      >F</button>
      <button 
        className={`sync-btn ${currentSyncMode === 'timeline' ? 'active' : ''}`}
        onClick={() => onSetSyncMode(paramId, 'timeline')}
        title={t('sync.toTimeline')}
      >T</button>
      <button 
        className={`sync-btn ${currentSyncMode === 'bpm' ? 'active' : ''}`}
        onClick={() => onSetSyncMode(paramId, 'bpm')}
        title={t('sync.toBpm')}
      >B</button>
    </div>
  );
};

export default SyncControls;
