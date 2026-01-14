import React, { useState, useEffect } from 'react';
import EffectEditor from './EffectEditor';
import GeneratorSettingsPanel from './GeneratorSettingsPanel';
import ClipPlaybackSettings from './ClipPlaybackSettings';
import CollapsiblePanel from './CollapsiblePanel';

const ClipSettingsPanel = ({
  selectedLayerIndex,
  selectedColIndex,
  clip,
  audioInfo,
  onAssignAudio,
  onRemoveAudio,
  onUpdatePlaybackSettings,
  onSetParamSync,
  onToggleDacMirror,
  onRemoveDac,
  onRemoveEffect,
  onAddEffect,
  onParameterChange,
  onGeneratorParameterChange,
  progressRef
}) => {
  const [dacStatuses, setDacStatuses] = useState({});

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onDacStatus) {
        const unsubscribe = window.electronAPI.onDacStatus((data) => {
            setDacStatuses(prev => ({
                ...prev,
                [data.ip]: data.status
            }));
        });
        return unsubscribe;
    }
  }, []);

  if (selectedLayerIndex === null || selectedColIndex === null) {
    return (
      <div className="clip-settings-panel settings-panel-base">
        <div className="settings-card-header"><h4>Clip Settings</h4></div>
        <p className="info-text">Select a clip to view settings.</p>
      </div>
    );
  }

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const effectData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (effectData && effectData.type && onAddEffect) {
        onAddEffect(effectData);
      }
    } catch (err) {
      console.error("Failed to drop effect in ClipSettingsPanel:", err);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const {
    effects = [],
    assignedDacs = [],
    playbackSettings = {},
    syncSettings = {},
    audioFile = null,
    type = null,
    generatorDefinition = null,
    currentParams = {},
    workerId = null
  } = clip || {};

  const hasEffects = effects.length > 0;
  const hasGenerator = type === 'generator' && !!generatorDefinition;
  const hasAssignedDacs = assignedDacs.length > 0;

  // Calculate clip duration in seconds
  // App.jsx passes playbackFps in state, but we don't have it here.
  // We'll try to get it from clip.fps or fallback.
  const clipDuration = (clip?.totalFrames || 30) / (clip?.fps || 30);

  // Calculate audio progress percentage
  const audioProgress = audioInfo && audioInfo.duration 
    ? (audioInfo.currentTime / audioInfo.duration) * 100 
    : 0;

  return (
    <div className="clip-settings-panel settings-panel-base" onDrop={handleDrop} onDragOver={handleDragOver}>
	  <div className="settings-card-header"><h4>Clip Settings</h4></div>
      
      <CollapsiblePanel title="Audio">
            {audioFile ? (
                <div className="assigned-audio-info">
                    <div className="audio-file-name" title={audioFile.path}>{audioFile.name}</div>
                    <div className="audio-progress-container">
                        <div className="audio-progress-bar" style={{ width: `${audioProgress}%` }}></div>
                    </div>
                    <div className="audio-time-info">
                        {audioInfo ? `${audioInfo.currentTime.toFixed(1)}s / ${audioInfo.duration.toFixed(1)}s` : '0.0s / 0.0s'}
                    </div>
                    <button className="remove-audio-btn" onClick={onRemoveAudio}>Remove Audio</button>
                </div>
            ) : (
                <button className="assign-audio-btn" onClick={onAssignAudio}>Assign Audio File</button>
            )}
      </CollapsiblePanel>

      <ClipPlaybackSettings 
        settings={playbackSettings} 
        onUpdate={(settings) => onUpdatePlaybackSettings(selectedLayerIndex, selectedColIndex, settings)} 
      />

      {hasAssignedDacs && (
        <CollapsiblePanel title="Assigned DACs">
            <ul className="assigned-dacs-list">
              {assignedDacs.map((dac, index) => {
                const status = dacStatuses[dac.ip];
                return (
                <li key={`${dac.unitID || dac.ip}-${dac.channel}-${index}`} className="assigned-dac-item">
                  <div className="dac-info-block">
                      <span className="dac-name-tiny">{dac.hostName || dac.ip} - Ch {dac.channel}</span>
                      {status && (
                          <div className="dac-status-tiny" style={{fontSize: '9px', color: '#888'}}>
                              State: {status.playback_state === 2 ? 'PLAYING' : status.playback_state === 1 ? 'PREPARED' : 'IDLE'} | 
                              Buf: {status.buffer_fullness}{status.buffer_capacity ? `/${status.buffer_capacity}` : ''} | 
                              PPS: {status.point_rate}
                          </div>
                      )}
                  </div>
                  <div className="dac-mirror-controls">
                    <button 
                        className={`mirror-btn ${dac.mirrorX ? 'active' : ''}`}
                        onClick={() => onToggleDacMirror(selectedLayerIndex, selectedColIndex, index, 'x')}
                        title="Mirror X Axis"
                    >X</button>
                    <button 
                        className={`mirror-btn ${dac.mirrorY ? 'active' : ''}`}
                        onClick={() => onToggleDacMirror(selectedLayerIndex, selectedColIndex, index, 'y')}
                        title="Mirror Y Axis"
                    >Y</button>
                  </div>
                  <button className="remove-dac-btn" onClick={() => onRemoveDac(index)}>×</button>
                </li>
              )})}
            </ul>
        </CollapsiblePanel>
      )}

      {hasGenerator && (
        <GeneratorSettingsPanel
          selectedGeneratorId={generatorDefinition.id}
          selectedGeneratorParams={currentParams}
          onParameterChange={onGeneratorParameterChange}
          syncSettings={syncSettings}
          onSetParamSync={onSetParamSync}
          layerIndex={selectedLayerIndex}
          colIndex={selectedColIndex}
          progressRef={progressRef}
          workerId={workerId}
          clipDuration={clipDuration}
        />
      )}

      <CollapsiblePanel title="Clip Effects">
        <div className="clip-effects-list" style={{ minHeight: '50px' }}>
          {hasEffects ? (
            effects.map((effect, effectIndex) => (
              <EffectEditor
                key={effect.id + effectIndex}
                effect={effect}
                assignedDacs={assignedDacs}
                syncSettings={syncSettings}
                onSetParamSync={onSetParamSync}
                context={{ layerIndex: selectedLayerIndex, colIndex: selectedColIndex, effectIndex, targetType: 'effect', workerId }}
                onParamChange={(paramId, paramValue) => 
                  onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, paramId, paramValue)
                }
                onRemove={() => onRemoveEffect(selectedLayerIndex, selectedColIndex, effectIndex)}
                progressRef={progressRef}
                clipDuration={clipDuration}
              />
            ))
          ) : (
            <div className="info-text" style={{padding: '20px', border: '1px dashed #444', borderRadius: '5px'}}>
              Drag Effects Here
            </div>
          )}
        </div>
      </CollapsiblePanel>
    </div>
  );
};

export default ClipSettingsPanel;
