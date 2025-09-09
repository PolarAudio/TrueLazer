import React from 'react';

const dacs = [
  { id: 'dac1-ch1', name: 'DAC 1 - Channel 1' },
  { id: 'dac1-ch2', name: 'DAC 1 - Channel 2' },
  { id: 'dac2-ch1', name: 'DAC 2 - Channel 1' },
  { id: 'dac2-ch2', name: 'DAC 2 - Channel 2' },
];

const DacPanel = () => {
  const handleDragStart = (e, dacId) => {
    e.dataTransfer.setData('application/x-dac', dacId);
  };

  return (
    <div className="dac-panel">
      <h3>DACs</h3>
      <div className="dac-list">
        {dacs.map((dac) => (
          <div
            key={dac.id}
            className="dac-item"
            draggable
            onDragStart={(e) => handleDragStart(e, dac.id)}
          >
            {dac.name}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DacPanel;
