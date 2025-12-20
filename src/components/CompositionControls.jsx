import React from 'react';

const MasterIntensitySlider = ({ masterIntensity, onMasterIntensityChange }) => (
    <div className="master-intensity-slider">
        <input type="range" min="0" max="1" step="0.01" value={masterIntensity} className="slider_hor" id="masterIntensityRange" onChange={(e) => onMasterIntensityChange(parseFloat(e.target.value))} />
    </div>
);

const AudioDeviceSelector = ({ devices, selectedId, onChange }) => (
    <div className="audio-device-selector">
        <select value={selectedId} onChange={(e) => onChange(e.target.value)} title="Audio Output Device">
            {devices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Device ${device.deviceId.slice(0, 5)}`}
                </option>
            ))}
        </select>
    </div>
);

const CompositionControls = ({ 
    masterIntensity, 
    onMasterIntensityChange, 
    onClearAllActive,
    isGlobalBlackout,
    onToggleGlobalBlackout
}) => (
  <div className="composition-controls">
	<span className="layer-control-button">Comp</span>
    <span className="layer-control-button" onClick={onClearAllActive} style={{ cursor: 'pointer' }}>X</span>
    <span 
        className="layer-control-button" 
        onClick={onToggleGlobalBlackout} 
        style={{ cursor: 'pointer', backgroundColor: isGlobalBlackout ? 'red' : '' }}
    >
        B
    </span>
    <MasterIntensitySlider masterIntensity={masterIntensity} onMasterIntensityChange={onMasterIntensityChange} />
  </div>
);

export default CompositionControls;
