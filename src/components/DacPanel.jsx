import React, { useState, useEffect, useCallback, useRef } from 'react';

const DacPanel = ({ onDacSelected }) => {
  const [dacs, setDacs] = useState([]);
  const [selectedDac, setSelectedDac] = useState(null);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [selectedNetworkInterface, setSelectedNetworkInterface] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const scanIntervalRef = useRef(null);
  const discoveryTimeoutRef = useRef(null);

  const startDiscovery = useCallback(() => {
    if (window.electronAPI) {
      window.electronAPI.send('discover-dacs', selectedNetworkInterface);
    }
  }, [selectedNetworkInterface]);

  const resetDiscoveryTimeout = useCallback(() => {
    if (discoveryTimeoutRef.current) {
      clearTimeout(discoveryTimeoutRef.current);
    }
    discoveryTimeoutRef.current = setTimeout(() => {
      console.log('60-second discovery timeout reached. Stopping scan.');
      setIsScanning(false);
    }, 60000); // 60 seconds
  }, []);

  useEffect(() => {
    if (window.electronAPI) {
      // Fetch network interfaces
      window.electronAPI.getNetworkInterfaces().then(interfaces => {
        setNetworkInterfaces(interfaces);
        if (interfaces.length > 0) {
          setSelectedNetworkInterface(interfaces[0]); // Select the first one by default
        }
      });

      // Set up DAC discovery listener
      const handleDacsDiscovered = (discoveredDacs) => {
        setDacs(discoveredDacs);
        resetDiscoveryTimeout(); // Reset timeout if DACs are discovered
      };

      const cleanup = window.electronAPI.on('dacs-discovered', handleDacsDiscovered);

      return () => {
        cleanup();
      };
    }
  }, [resetDiscoveryTimeout]);

  useEffect(() => {
    if (isScanning) {
      // Start scanning immediately
      startDiscovery();
      resetDiscoveryTimeout(); // Start/reset timeout when scanning begins
      // Set up interval for continuous scanning
      scanIntervalRef.current = setInterval(startDiscovery, 5000); // Scan every 5 seconds
    } else {
      // Stop scanning
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
      if (discoveryTimeoutRef.current) {
        clearTimeout(discoveryTimeoutRef.current);
        discoveryTimeoutRef.current = null;
      }
      // Optionally, send a message to close the socket in the main process
      if (window.electronAPI) {
        window.electronAPI.send('stop-dac-discovery');
      }
    }

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
      if (discoveryTimeoutRef.current) {
        clearTimeout(discoveryTimeoutRef.current);
      }
    };
  }, [isScanning, startDiscovery, resetDiscoveryTimeout]);

  const handleDacClick = (dac) => {
    setSelectedDac(dac);
    onDacSelected(dac);
  };

  const handleNetworkInterfaceChange = (e) => {
    const selectedName = e.target.value;
    const interfaceFound = networkInterfaces.find(iface => iface.name === selectedName);
    setSelectedNetworkInterface(interfaceFound || null);
  };

  const handleDragStart = (e, dacId) => {
    e.dataTransfer.setData('application/x-dac', dacId);
  };

  return (
    <div className="dac-panel">
      <h3>DACs</h3>
      <div className="network-interface-selector">
        <label htmlFor="network-interface-select">Network Interface:</label>
        <select id="network-interface-select" onChange={handleNetworkInterfaceChange} value={selectedNetworkInterface ? selectedNetworkInterface.name : ''}>
          {networkInterfaces.map(iface => (
            <option key={iface.name} value={iface.name}>
              {iface.name} ({iface.address})
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={isScanning} onChange={(e) => setIsScanning(e.target.checked)} /> Scan
        </label>
      </div>
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
