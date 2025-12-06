import React, { useState, useEffect, useCallback, useRef } from 'react';

const DacPanel = ({ onDacSelected }) => {
  const [dacs, setDacs] = useState([]);
  const [selectedDac, setSelectedDac] = useState(null);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [selectedNetworkInterface, setSelectedNetworkInterface] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const scanIntervalRef = useRef(null);
  const discoveryTimeoutRef = useRef(null);

  const startDiscovery = () => {
    if (window.electronAPI) {
      window.electronAPI.send('discover-dacs', selectedNetworkInterface);
    }
  };

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
        console.log('Fetched network interfaces:', interfaces); // Debug log
        if (interfaces.length > 0) {
          setSelectedNetworkInterface(interfaces[0]); // Select the first one by default
          console.log('Selected network interface:', interfaces[0]); // Debug log
        }
      });

      // Set up DAC discovery listener
      const handleDacsDiscovered = (discoveredDacs) => {
        setDacs(discoveredDacs);
        console.log('DACs discovered:', discoveredDacs); // Debug log
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
      console.log('Starting DAC scan...'); // Debug log
      const scan = () => startDiscovery();
      // Start scanning immediately
      scan();
      resetDiscoveryTimeout(); // Start/reset timeout when scanning begins
      // Set up interval for continuous scanning
      scanIntervalRef.current = setInterval(scan, 5000); // Scan every 5 seconds
    } else {
      console.log('DAC scan inactive...'); // Debug log
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
  }, [isScanning, selectedNetworkInterface, resetDiscoveryTimeout]);

  const handleDacClick = (dac) => {
    setSelectedDac(dac);
    onDacSelected(dac);
  };

  const handleNetworkInterfaceChange = (e) => {
    const wasScanning = isScanning;
    if (wasScanning) {
      setIsScanning(false);
    }

    const selectedName = e.target.value;
    const interfaceFound = networkInterfaces.find(iface => iface.name === selectedName);
    setSelectedNetworkInterface(interfaceFound || null);

    if (wasScanning) {
      setIsScanning(true);
    }
  };

  const handleDragStart = (e, dacJSON) => {
    e.dataTransfer.setData('application/json', dacJSON);
  };

  return (
    <div className="dac-panel">
      <h3>DACs</h3>
      <div className="network-interface-selector">
        <select id="network-interface-select" onChange={handleNetworkInterfaceChange} value={selectedNetworkInterface ? selectedNetworkInterface.name : ''}>
          {networkInterfaces.map(iface => (
            <option key={iface.name} value={iface.name}>
              {iface.name} ({iface.address})
            </option>
          ))}
        </select>
          <input type="checkbox" checked={isScanning} onChange={(e) => setIsScanning(e.target.checked)} />
      </div>
      <div className="dac-list">
        {dacs.map((dac) => (
          <div key={dac.ip} className="dac-group">
            <div className="dac-ip">{dac.ip}</div>
            <div className="dac-channels">
              {dac.channels.map((channel) => (
                <div
                  key={`${dac.ip}-${channel}`}
                  className={`dac-item ${
                    selectedDac && selectedDac.ip === dac.ip && selectedDac.channel === channel ? 'selected' : ''
                  }`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, JSON.stringify({ ...dac, channel }))}
                  onClick={() => handleDacClick({ ...dac, channel })}
                >
                  Channel {channel}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DacPanel;
