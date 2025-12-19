import React from 'react';
import EffectEditor from './EffectEditor';
import GeneratorSettingsPanel from './GeneratorSettingsPanel';

const SettingsPanel = ({
  effects,
  assignedDacs = [],
  onRemoveDac,
  audioFile,
  onAssignAudio,
  onRemoveAudio,
  audioInfo,
  onParameterChange,
  selectedLayerIndex,
  selectedColIndex,
  selectedGeneratorId,
  selectedGeneratorParams,
  onGeneratorParameterChange,
}) => {
  const hasEffects = effects && effects.length > 0;
  const hasGenerator = !!selectedGeneratorId;
  const hasAssignedDacs = assignedDacs && assignedDacs.length > 0;

  // Calculate audio progress percentage
  const audioProgress = audioInfo && audioInfo.duration 
    ? (audioInfo.currentTime / audioInfo.duration) * 100 
    : 0;

  return (
    <div className="settings-panel">
      <h3>Settings</h3>
      
      {selectedLayerIndex !== null && selectedColIndex !== null ? (
        <>
          <div className="audio-settings-section">
              <h4>Audio</h4>
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
          </div>

          {hasAssignedDacs && (
            <div className="assigned-dacs-settings">
              <h4>Assigned DACs</h4>
              <ul className="assigned-dacs-list">
                {assignedDacs.map((dac, index) => (
                  <li key={`${dac.unitID || dac.ip}-${dac.channel}-${index}`} className="assigned-dac-item">
                    <span>{dac.hostName || dac.ip} - Ch {dac.channel}</span>
                    <button className="remove-dac-btn" onClick={() => onRemoveDac(index)}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasGenerator && (
            <GeneratorSettingsPanel
              selectedGeneratorId={selectedGeneratorId}
              selectedGeneratorParams={selectedGeneratorParams}
              onParameterChange={onGeneratorParameterChange}
            />
          )}

          {hasEffects && effects.map((effect, effectIndex) => (
            <EffectEditor
              key={effect.id + effectIndex} // More robust key
              effect={effect}
              // Correctly pass parameters to the handler from App.jsx
              onParamChange={(paramId, paramValue) => 
                onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, paramId, paramValue)
              }
            />
          ))}

          {!hasGenerator && !hasEffects && (
            <p>No settings to display for the selected clip.</p>
          )}
        </>
      ) : (
        <p>Select a clip to view settings.</p>
      )}
    </div>
  );
};

export default SettingsPanel;
