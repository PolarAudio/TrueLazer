import React, { useEffect } from 'react';

const SelectedClipPreview = ({ selectedClipData }) => {
  useEffect(() => {
    console.log('SelectedClipPreview received data:', selectedClipData);
  }, [selectedClipData]);

  return (
    <div className="selected-clip-preview">
      <h3>Selected Clip Preview</h3>
      <div className="preview-area">
        {selectedClipData ? (
          <p>
            Clip: {selectedClipData.clipName}<br/>
            Generator: {selectedClipData.generatorId ? selectedClipData.generatorId.toUpperCase() : 'None'}<br/>
            Effects: {selectedClipData.clipEffects && selectedClipData.clipEffects.length > 0 ? selectedClipData.clipEffects.map(effect => effect.toUpperCase()).join(', ') : 'None'}
          </p>
        ) : (
          <p>No clip selected.</p>
        )}
      </div>
    </div>
  );
};

export default SelectedClipPreview;
