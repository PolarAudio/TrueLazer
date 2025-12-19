import React from 'react';
import EffectEditor from './EffectEditor';
import GeneratorSettingsPanel from './GeneratorSettingsPanel';

const SettingsPanel = ({
  effects,
  onParameterChange,
  selectedLayerIndex,
  selectedColIndex,
  selectedGeneratorId,
  selectedGeneratorParams,
  onGeneratorParameterChange,
}) => {
  const hasEffects = effects && effects.length > 0;
  const hasGenerator = !!selectedGeneratorId;

  return (
    <div className="settings-panel">
      <h3>Settings</h3>
      
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
    </div>
  );
};

export default SettingsPanel;
