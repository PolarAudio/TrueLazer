import React from 'react';
import { effectDefinitions } from '../utils/effectDefinitions';
import { useTranslation } from '../i18n';

const EffectPanel = () => {
  const { t } = useTranslation();
  const handleDragStart = (e, effect) => {
    e.dataTransfer.setData('application/json', JSON.stringify(effect));
  };

  return (
    <div className="effect-panel">
      {effectDefinitions.map(effect => (
        <div 
          key={effect.id}
          draggable 
          onDragStart={(e) => handleDragStart(e, effect)}
          className="effect-item"
        >
          {t(`effect.${effect.id}.name`)}
        </div>
      ))}
    </div>
  );
};

export default EffectPanel;
