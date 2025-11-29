import React from 'react';
import EffectEditor from './EffectEditor';
import GeneratorSettingsPanel from './GeneratorSettingsPanel'; // Import the new component

const SettingsPanel = ({
  effects,
  onParameterChange,
  selectedLayerIndex, // Still needed for effect parameter changes
  selectedColIndex,   // Still needed for effect parameter changes
  selectedGeneratorId,
  selectedGeneratorParams,
  onGeneratorParameterChange,
}) => {
  if (selectedGeneratorId) {
    return (
      <div className="settings-panel">
        <h3>Settings</h3>
        <GeneratorSettingsPanel
          selectedGeneratorId={selectedGeneratorId}
          selectedGeneratorParams={selectedGeneratorParams}
          onParameterChange={onGeneratorParameterChange}
        />
      </div>
    );
  }

  if (!effects || effects.length === 0) {
    return (
      <div className="settings-panel">
        <h3>Settings</h3>
        <p>No settings to display for the selected clip.</p>
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <h3>Settings</h3>
      {effects.map((effect, effectIndex) => (
        <EffectEditor
          key={effectIndex}
          effect={effect}
          onParamChange={(effectId, paramName, value) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, paramName, value)}
        />
      ))}
    </div>
  );
};

export default SettingsPanel;
