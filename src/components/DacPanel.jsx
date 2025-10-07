import React, { useState, useEffect } from 'react';

const DacPanel = ({ onDacSelected }) => {
  const [dacs, setDacs] = useState([]);
  const [selectedDac, setSelectedDac] = useState(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.send('discover-dacs');

      const handleDacsDiscovered = (event, discoveredDacs) => {
        setDacs(discoveredDacs);
      };

      const cleanup = window.electronAPI.on('dacs-discovered', handleDacsDiscovered);

      return () => {
        cleanup();
      };
    }
  }, []);

  const handleDacClick = (dac) => {
    setSelectedDac(dac);
    onDacSelected(dac);
  };

  const handleDragStart = (e, dacId) => {
    e.dataTransfer.setData('application/x-dac', dacId);
  };

  return (
    <div className="dac-panel">
      <h3>DACs</h3>
      <div className="dac-list">
        {dacs.map((dac) => (
          <div
            key={dac.ip}
            className={`dac-item ${selectedDac && selectedDac.ip === dac.ip ? 'selected' : ''}`}
            draggable
            onDragStart={(e) => handleDragStart(e, dac.ip)}
            onClick={() => handleDacClick(dac)}
          >
            {dac.ip}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DacPanel;
