import React from 'react';
import EffectEditor from './EffectEditor';

const SettingsPanel = ({ effects, onParameterChange, selectedLayerIndex, selectedColIndex }) => {
  if (!effects || effects.length === 0) {
    return (
      <div className="settings-panel">
        <h3>Settings</h3>
        <p>No effects applied to the selected clip/layer.</p>
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
