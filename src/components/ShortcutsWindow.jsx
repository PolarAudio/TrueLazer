import React from 'react';

const ShortcutsWindow = ({ show, onClose }) => {
  if (!show) {
    return null;
  }

  return (
    <div className="shortcuts-modal-overlay">
      <div className="shortcuts-modal-content">
        <h2>Shortcuts Settings</h2>
        <div className="shortcuts-section">
          <h3>MIDI</h3>
          <p>MIDI device settings and mapping options will go here.</p>
        </div>
        <div className="shortcuts-section">
          <h3>DMX/Artnet</h3>
          <p>DMX/Artnet configuration and mapping options will go here.</p>
        </div>
        <div className="shortcuts-section">
          <h3>OSC</h3>
          <p>OSC settings and mapping options will go here.</p>
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default ShortcutsWindow;
