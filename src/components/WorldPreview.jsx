import React, { useEffect } from 'react';

const WorldPreview = ({ worldData }) => {
  useEffect(() => {
    console.log('worldPreview received data:', worldData);
  }, [selectedData]);

  return (
    <div className="world-preview">
      <h3>World Preview</h3>
      <div className="preview-area">
        {selectedClipData ? (
          <p>
            Clip: {worldData.clipName}<br/>
            Generator: {worldClipData.generatorId ? worldData.generatorId.toUpperCase() : 'None'}<br/>
            Effects: {worldData.clipEffects && worldData.clipEffects.length > 0 ? worldData.clipEffects.map(effect => effect.toUpperCase()).join(', ') : 'None'}
          </p>
        ) : (
          <p>No clip selected.</p>
        )}
      </div>
    </div>
  );
};

export default WorldPreview;