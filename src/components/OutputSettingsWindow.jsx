import React from 'react';

const OutputSettingsWindow = ({ show, onClose }) => {
  if (!show) {
    return null;
  }

  return (
    <div className="output-settings-modal-overlay">
      <div className="output-settings-modal-content">
        <h2>Output Settings</h2>
        <div className="settings-section">
          <h3>Projector Settings</h3>
          <p>Scan Speed, Size, Mirroring, Safe-zones, Warping options will go here.</p>
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default OutputSettingsWindow;
