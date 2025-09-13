import React, { useEffect, useRef } from 'react';
import IldaPlayer from './IldaPlayer';

const SelectedClipPreview = ({ selectedClipData }) => {
  return (
    <div className="selected-clip-preview">
      <h3>Selected Clip Preview</h3>
      <div className="preview-area">
        {selectedClipData && typeof selectedClipData.generatorId === 'object' ? (
          <IldaPlayer parsedData={selectedClipData.generatorId} />
        ) : (
          <p>No ILDA clip selected or invalid data.</p>
        )}
      </div>
    </div>
  );
};

export default SelectedClipPreview;
