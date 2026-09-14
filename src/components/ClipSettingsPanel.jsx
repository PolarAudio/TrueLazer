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
  dacSettings = {},
  onAssignAudio,
  onRemoveAudio,
  onUpdateAudioVolume,
  onUpdatePlaybackSettings,
  onSetParamSync,
  onToggleDacMirror,
  onRemoveDac,
  onReorderDacs,
  layerDacs = [],
  onRemoveEffect,
  onReorderEffects,
  onAddEffect,
  onParameterChange,
  onGeneratorParameterChange,
  onUpdateClipUiState,
  uiState: uiStateProp,
  progressRef,
  onAudioError,
  onRegisterPreset,
  liveFramesRef,
  activePageId,
  playbackSettingsOverride
}) => {
  const [dacStatuses, setDacStatuses] = useState({});
  const [draggedEffectIndex, setDraggedEffectIndex] = useState(null);
  const { seekAudio } = useAudio();
  const lastReorderTimeRef = useRef(0);

  // The channels an effect actually sees at runtime are the layer's assigned
  // DACs followed by the clip's own (deduped by ip:channel). Mirror that so
  // Delay/Chase custom order lists channels even when they are assigned to the
  // layer rather than to the clip. (Hooks must run before the early return.)
  const clipAssignedDacs = clip?.assignedDacs || [];
  const effectiveAssignedDacs = React.useMemo(() => {
    const combined = [...(layerDacs || []), ...clipAssignedDacs];
    const seen = new Set();
    const list = [];
    combined.forEach(d => {
        const ch = d.channel !== undefined ? d.channel : (d.channels && d.channels.length > 0 ? d.channels[0].serviceID : 0);
        const key = `${d.ip}:${ch}`;
        if (!seen.has(key)) { seen.add(key); list.push({ ...d, channel: ch }); }
    });
    return list;
  }, [layerDacs, clipAssignedDacs]);

  // Collapse/UI state comes from committed state (always fresh), NOT from the
  // live clip object - the live ref may lag state while a clip-effect param edit
  // is pending, and a stale collapse map would let toggling one panel reset
  // other panels' collapsed state.
  const uiState = uiStateProp || clip?.uiState || {};
  const collapsedPanels = uiState.collapsedPanels || {};

  const togglePanel = (panelId, isNowCollapsed) => {
    if (onUpdateClipUiState) {
        onUpdateClipUiState(selectedLayerIndex, selectedColIndex, {
            collapsedPanels: {
                [panelId]: isNowCollapsed
            }
        });
    }
  };

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
    syncSettings = {},
    audioFile = null,
    audioVolume = 1.0,
    type = null,
    generatorDefinition = null,
    currentParams = {},
    workerId = null
  } = clip || {};

  // Playback settings come from committed state when provided (so the UI updates the
  // instant a control is touched) instead of the live ref clip, which only syncs
  // after commit and would show stale values on the first interaction.
  const playbackSettings = (playbackSettingsOverride !== undefined ? playbackSettingsOverride : clip?.playbackSettings) || {};

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

  const pageIdx = clip?.pageId !== undefined ? clip.pageId : selectedLayerIndex !== null ? (clip?.pageId ?? 0) : 0; // Fallback to 0 if not available
  const derivedWorkerId = workerId || (type === 'ilda' ? `ilda-${selectedLayerIndex}-${selectedColIndex}` : (type === 'generator' ? `generator-${pageIdx}-${selectedLayerIndex}-${selectedColIndex}` : null));

  const currentPointCount = (liveFramesRef?.current && derivedWorkerId) ? (liveFramesRef.current[derivedWorkerId]?.points?.length / 8 || 0) : 0;

  const audioProgress = audioInfo && audioInfo.duration 
    ? (audioInfo.currentTime / audioInfo.duration) * 100 
    : 0;

  return (
    <div className="clip-settings-panel settings-panel-base" onDrop={handleDrop} onDragOver={handleDragOver}>
      <CollapsiblePanel 
        title="Audio" 
        isCollapsed={!!collapsedPanels['audio']}
        onToggle={(val) => togglePanel('audio', val)}
      >
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
        uiState={uiState}
        onUpdateUiState={(newUi) => onUpdateClipUiState(selectedLayerIndex, selectedColIndex, newUi)}
      />

      {hasAssignedDacs && (
        <CollapsiblePanel 
            title="Assigned DACs"
            isCollapsed={!!collapsedPanels['dacs']}
            onToggle={(val) => togglePanel('dacs', val)}
        >
            <ul className="assigned-dacs-list">
              {assignedDacs.map((dac, index) => {
                const status = dacStatuses[dac.ip];
                return (
                <li key={`${dac.unitID || dac.ip}-${dac.channel}-${index}`} className="assigned-dac-item">
                  <div className="dac-order-controls">
                    <span className="dac-order-index">{index + 1}</span>
                    <button
                        className="dac-order-btn"
                        disabled={index === 0}
                        onClick={() => onReorderDacs(selectedLayerIndex, selectedColIndex, index, index - 1)}
                        title="Move Up"
                    >▲</button>
                    <button
                        className="dac-order-btn"
                        disabled={index === assignedDacs.length - 1}
                        onClick={() => onReorderDacs(selectedLayerIndex, selectedColIndex, index, index + 1)}
                        title="Move Down"
                    >▼</button>
                  </div>
                  <div className="dac-info-block">
                      <span className="dac-name-tiny">{dacSettings[`${dac.ip}:${dac.channel}`]?.name || `${dac.hostName || dac.ip} - Ch ${dac.channel}`}</span>
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
          uiState={uiState}
          onUpdateUiState={(newUi) => onUpdateClipUiState(selectedLayerIndex, selectedColIndex, newUi)}
          onRegisterPreset={onRegisterPreset}
        />
      )}

      <CollapsiblePanel 
        title="Clip Effects"
        isCollapsed={!!collapsedPanels['effects']}
        onToggle={(val) => togglePanel('effects', val)}
      >
        <div className="clip-effects-list" style={{ minHeight: '50px' }} onDrop={handleEffectDrop}>
          {hasEffects ? (
            effects.map((effect, effectIndex) => (
              <div 
                key={effect.instanceId || (effect.id + effectIndex)}
                onDragOver={(e) => handleEffectDragOver(e, effectIndex)}
                style={{ marginBottom: '4px' }}
              >
                <EffectEditor
                  effect={effect}
                  assignedDacs={effectiveAssignedDacs}
                  dacSettings={dacSettings}
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
                  uiState={uiState}
                  onUpdateUiState={(newUi) => onUpdateClipUiState(selectedLayerIndex, selectedColIndex, newUi)}
                  onRegisterPreset={onRegisterPreset}
                  currentPointCount={currentPointCount}
                  dragHandle={
                    <div 
                        draggable
                        onDragStart={() => handleEffectDragStart(effectIndex)}
                        style={{ cursor: 'grab', marginRight: '5px', display: 'flex', alignItems: 'center', color: '#666' }}
                        title="Drag to reorder"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
                        </svg>
                    </div>
                  }
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

export default React.memo(ClipSettingsPanel);