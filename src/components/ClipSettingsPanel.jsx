import React from 'react';
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
  onParameterChange,
  onGeneratorParameterChange
}) => {
  if (selectedLayerIndex === null || selectedColIndex === null) {
    return (
      <div className="clip-settings-panel settings-panel-base">
        <div className="settings-card-header"><h4>Clip Settings</h4></div>
        <p className="info-text">Select a clip to view settings.</p>
      </div>
    );
  }

  const {
    effects = [],
    assignedDacs = [],
    playbackSettings = {},
    syncSettings = {},
    audioFile = null,
    type = null,
    generatorDefinition = null,
    currentParams = {}
  } = clip || {};

  const hasEffects = effects.length > 0;
  const hasGenerator = type === 'generator' && !!generatorDefinition;
  const hasAssignedDacs = assignedDacs.length > 0;

  // Calculate audio progress percentage
  const audioProgress = audioInfo && audioInfo.duration 
    ? (audioInfo.currentTime / audioInfo.duration) * 100 
    : 0;

  return (
    <div className="clip-settings-panel settings-panel-base">
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
              {assignedDacs.map((dac, index) => (
                <li key={`${dac.unitID || dac.ip}-${dac.channel}-${index}`} className="assigned-dac-item">
                  <span className="dac-name-tiny">{dac.hostName || dac.ip} - Ch {dac.channel}</span>
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
              ))}
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
        />
      )}

      {hasEffects && effects.map((effect, effectIndex) => (
        <EffectEditor
          key={effect.id + effectIndex}
          effect={effect}
          assignedDacs={assignedDacs}
          syncSettings={syncSettings}
          onSetParamSync={onSetParamSync}
          context={{ layerIndex: selectedLayerIndex, colIndex: selectedColIndex, effectIndex, targetType: 'effect' }}
          onParamChange={(paramId, paramValue) => 
            onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, paramId, paramValue)
          }
          onRemove={() => onRemoveEffect(selectedLayerIndex, selectedColIndex, effectIndex)}
        />
      ))}

      {!hasGenerator && !hasEffects && (
        <p className="info-text">No generators or effects applied.</p>
      )}
    </div>
  );
};

export default ClipSettingsPanel;
