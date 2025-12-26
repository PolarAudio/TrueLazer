import React from 'react';
import Mappable from './Mappable';

const MasterIntensitySlider = ({ masterIntensity, onMasterIntensityChange }) => (
    <div className="master-intensity-slider">
        <Mappable id="master_intensity">
            <input type="range" min="0" max="1" step="0.01" value={masterIntensity} className="slider_hor" id="masterIntensityRange" onChange={(e) => onMasterIntensityChange(parseFloat(e.target.value))} />
        </Mappable>
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
    <Mappable id="comp_clear">
        <span className="layer-control-button" onClick={onClearAllActive} style={{ cursor: 'pointer' }}>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-x-lg" viewBox="0 0 16 16">
				<path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
			</svg>
		</span>
    </Mappable>
    <Mappable id="comp_blackout" style={{ width: '100%', display: 'flex' }}>
        <span 
            className="layer-control-button" 
            onClick={onToggleGlobalBlackout} 
            style={{ cursor: 'pointer', backgroundColor: isGlobalBlackout ? 'red' : '' }}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-eye-slash-fill" viewBox="0 0 16 16">
				<path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7 7 0 0 0 2.79-.588M5.21 3.088A7 7 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474z"/>
				<path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171 6-12-12 .708-.708 12 12z"/>
			</svg>
        </span>
    </Mappable>
    <MasterIntensitySlider masterIntensity={masterIntensity} onMasterIntensityChange={onMasterIntensityChange} />
  </div>
);

export default CompositionControls;
