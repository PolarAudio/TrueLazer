import React from 'react';

const MasterIntensitySlider = ({ masterIntensity, onMasterIntensityChange }) => (
    <div className="master-intensity-slider">
        <input type="range" min="0" max="1" step="0.01" value={masterIntensity} className="slider_hor" id="masterIntensityRange" onChange={(e) => onMasterIntensityChange(parseFloat(e.target.value))} />
    </div>
);

const CompositionControls = ({ masterIntensity, onMasterIntensityChange }) => (
  <div className="composition-controls">
	<span className="layer-control-button">Comp</span>
    <span className="layer-control-button">X</span>
    <span className="layer-control-button">B</span>
    <MasterIntensitySlider masterIntensity={masterIntensity} onMasterIntensityChange={onMasterIntensityChange} />
  </div>
);

export default CompositionControls;
