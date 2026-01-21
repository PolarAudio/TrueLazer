import React, { useState, useEffect, useRef } from 'react';
import EffectEditor from './EffectEditor';
import GeneratorSettingsPanel from './GeneratorSettingsPanel';
import ClipPlaybackSettings from './ClipPlaybackSettings';
import CollapsiblePanel from './CollapsiblePanel';
import Mappable from './Mappable';
import WavePlayer from './WavePlayer';
import { useAudio } from '../contexts/AudioContext';

const ClipSettingsPanel = ({
  selectedLayerIndex,
  selectedColIndex,
  clip,
  audioInfo,
  bpm,
  getFftLevels,
  onAssignAudio,
  onRemoveAudio,
  onUpdateAudioVolume,
  onUpdatePlaybackSettings,
  onSetParamSync,
  onToggleDacMirror,
  onRemoveDac,
  onRemoveEffect,
  onReorderEffects,
  onAddEffect,
  onParameterChange,
  onGeneratorParameterChange,
  progressRef,
  onAudioError
}) => {
  const [dacStatuses, setDacStatuses] = useState({});
  const [draggedEffectIndex, setDraggedEffectIndex] = useState(null);
  const { seekAudio } = useAudio();
  const lastReorderTimeRef = useRef(0);

  const handleWavePlayerError = React.useCallback((err) => {
      if (onAudioError) onAudioError(selectedLayerIndex, selectedColIndex);
  }, [onAudioError, selectedLayerIndex, selectedColIndex]);

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
      const rawData = e.dataTransfer.getData('application/json');
      if (!rawData) return;
      const effectData = JSON.parse(rawData);
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

  const handleEffectDragStart = (index) => {
    setDraggedEffectIndex(index);
  };

  const handleEffectDragOver = (e, index) => {
    e.preventDefault();
    if (draggedEffectIndex === null || draggedEffectIndex === index) return;
    
    const now = Date.now();
    if (now - lastReorderTimeRef.current < 200) return;
    lastReorderTimeRef.current = now;

    if (onReorderEffects) {
        onReorderEffects(selectedLayerIndex, selectedColIndex, draggedEffectIndex, index);
        setDraggedEffectIndex(index);
    }
  };

  const handleEffectDrop = (e) => {
    setDraggedEffectIndex(null);
  };

  const {
    effects = [],
    assignedDacs = [],
    playbackSettings = {},
    syncSettings = {},
    audioFile = null,
    audioVolume = 1.0,
    type = null,
    generatorDefinition = null,
    currentParams = {},
    workerId = null
  } = clip || {};

  const hasEffects = effects.length > 0;
  const hasGenerator = type === 'generator' && !!generatorDefinition;
  const hasAssignedDacs = assignedDacs.length > 0;

  // Correctly calculate clip duration based on mode
  let clipDuration = 1;
  if (playbackSettings.mode === 'timeline') {
      clipDuration = playbackSettings.duration || 1;
  } else if (playbackSettings.mode === 'bpm') {
      const currentBpm = bpm || 120; 
      clipDuration = ((playbackSettings.beats || 8) * 60) / currentBpm;
  } else {
      const clipFps = playbackSettings.fps || clip?.fps || 30;
      const totalFrames = clip?.totalFrames || 30;
      clipDuration = totalFrames / clipFps;
  }

  // Derive Worker ID for progress tracking
  const derivedWorkerId = workerId || (type === 'ilda' ? `ilda-${selectedLayerIndex}-${selectedColIndex}` : (type === 'generator' ? `generator-${selectedLayerIndex}-${selectedColIndex}` : null));

  const audioProgress = audioInfo && audioInfo.duration 
    ? (audioInfo.currentTime / audioInfo.duration) * 100 
    : 0;

  return (
    <div className="clip-settings-panel settings-panel-base" onDrop={handleDrop} onDragOver={handleDragOver}>
	  <div className="settings-card-header"><h4>Clip Settings</h4></div>
      
      <CollapsiblePanel title="Audio">
            {audioFile ? (
                <div className="assigned-audio-info" style={{ position: 'relative' }}>
                    <button 
                        className="remove-effect-btn" 
                        onClick={onRemoveAudio}
                        style={{ position: 'absolute', top: '-5px', right: '-5px', fontSize: '14px' }}
                    >×</button>
                    <div className="audio-file-name" title={audioFile.path} style={{ paddingRight: '15px', marginBottom: '8px', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{audioFile.name}</div>
                    
                    <WavePlayer 
                        audioFile={audioFile} 
                        audioInfo={audioInfo} 
                        layerIndex={selectedLayerIndex}
                        onSeek={(time) => seekAudio(selectedLayerIndex, time)}
                        onLoadError={handleWavePlayerError}
                    />

                    <div className="audio-volume-control" style={{ marginTop: '10px' }}>
                        <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>Volume: {Math.round(audioVolume * 100)}%</label>
                        <input 
                            type="range" 
                            min="0" max="1" step="0.01" 
                            value={audioVolume} 
                            onChange={(e) => onUpdateAudioVolume(selectedLayerIndex, selectedColIndex, parseFloat(e.target.value))}
                            className="slider_hor"
                            style={{ width: '100%', height: '4px' }}
                        />
                    </div>
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
          workerId={derivedWorkerId}
          clipDuration={clipDuration}
          bpm={bpm}
          getFftLevels={getFftLevels}
        />
      )}

      <CollapsiblePanel title="Clip Effects">
        <div className="clip-effects-list" style={{ minHeight: '50px' }} onDrop={handleEffectDrop}>
          {hasEffects ? (
            effects.map((effect, effectIndex) => (
              <div 
                key={effect.instanceId || (effect.id + effectIndex)}
                draggable
                onDragStart={() => handleEffectDragStart(effectIndex)}
                onDragOver={(e) => handleEffectDragOver(e, effectIndex)}
              >
                <EffectEditor
                  effect={effect}
                  assignedDacs={assignedDacs}
                  syncSettings={syncSettings}
                  onSetParamSync={onSetParamSync}
                  context={{ layerIndex: selectedLayerIndex, colIndex: selectedColIndex, effectIndex, targetType: 'effect', workerId: derivedWorkerId }}
                  onParamChange={(paramId, paramValue) => 
                    onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, paramId, paramValue)
                  }
                  onRemove={() => onRemoveEffect(selectedLayerIndex, selectedColIndex, effectIndex)}
                  progressRef={progressRef}
                  clipDuration={clipDuration}
                  bpm={bpm}
                  getFftLevels={getFftLevels}
                />
              </div>
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