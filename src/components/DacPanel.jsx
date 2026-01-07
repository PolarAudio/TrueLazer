import React, { useState, useEffect } from 'react';
import RadialKnob from './RadialKnob';
import Mappable from './Mappable';

const DacPanel = ({ dacs = [], onDacSelected, onDacsDiscovered, dacSettings = {}, onUpdateDacSettings }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [selectedDac, setSelectedDac] = useState(null);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [selectedNetworkInterface, setSelectedNetworkInterface] = useState(null);
  const scanInProgressRef = React.useRef(false);

  useEffect(() => {
    // Call the exposed API from preload script
    if (window.electronAPI) {
      window.electronAPI.getNetworkInterfaces().then(interfaces => {
        setNetworkInterfaces(interfaces);
        if (interfaces.length > 0) {
          setSelectedNetworkInterface(interfaces[0]);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (isScanning && !scanInProgressRef.current) {
      scanInProgressRef.current = true;
      console.log('Starting DAC scan on:', selectedNetworkInterface?.address);
      if (window.electronAPI) {
          window.electronAPI.discoverDacs(2000, selectedNetworkInterface?.address)
          .then(async (discoveredDacs) => {
            console.log('DACs discovered:', discoveredDacs);
            const dacsWithServices = await Promise.all(
              discoveredDacs.map(async (dac) => {
                try {
                  const services = await window.electronAPI.getDacServices(dac.ip, selectedNetworkInterface?.address, dac.type);
                  // Filter for valid services (e.g., serviceType for laser graphics)
                  // For IDN, serviceID 0 is often a management service, so we filter it out.
                  // For EtherDream, we typically only have one service at ID 0.
                  const laserServices = (dac.type && dac.type.toLowerCase() === 'etherdream') 
                    ? services 
                    : services.filter(s => s.serviceID !== 0);
                  return { ...dac, channels: laserServices };
                } catch (error) {
                  console.error(`Error fetching services for DAC ${dac.ip}:`, error);
                  return { ...dac, channels: [] };
                }
              })
            );
            if (onDacsDiscovered) {
              onDacsDiscovered(dacsWithServices);
            }
          })
          .catch(err => {
            console.error('Error discovering DACs:', err);
          })
          .finally(() => {
            setIsScanning(false);
            scanInProgressRef.current = false;
          });
      } else {
        console.warn('electronAPI is not available. Cannot discover DACs.');
        setIsScanning(false);
        scanInProgressRef.current = false;
      }
    }
  }, [isScanning, selectedNetworkInterface, onDacsDiscovered]);

  const handleDacClick = (dac, channelId) => {
    const dacWithChannel = { ...dac, channel: channelId };
    setSelectedDac(dacWithChannel);
    if (onDacSelected) {
      onDacSelected(dacWithChannel);
    }
  };

  const handleDragStart = (e, dac, channelId) => {
    const dacWithChannel = { ...dac, channel: channelId };
    e.dataTransfer.setData('application/json', JSON.stringify(dacWithChannel));
  };
  
  const handleNetworkInterfaceChange = (e) => {
    const selectedAddress = e.target.value;
    const iface = networkInterfaces.find(iface => iface.address === selectedAddress);
    setSelectedNetworkInterface(iface);
  };

  const handleGroupDragStart = (e, dac) => {
    // When dragging the group, we pass all channels
    const dacWithAllChannels = { ...dac, allChannels: true };
    e.dataTransfer.setData('application/json', JSON.stringify(dacWithAllChannels));
  };

  return (
    <div className="dac-panel">
      <div className="settings-card-header"><h4>DACs</h4></div>
      <div className="network-interface-selector">
        <select onChange={handleNetworkInterfaceChange} value={selectedNetworkInterface?.address || ''}>
          {networkInterfaces.map(iface => (
            <option key={iface.address} value={iface.address}>
              {iface.name} ({iface.address})
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={isScanning} onChange={(e) => setIsScanning(e.target.checked)} disabled={isScanning} />
          Scan
        </label>
      </div>
      <div className="dac-list">
        {dacs.map((dac) => (
          <div key={dac.unitID || dac.ip}
            className={`dac-group`}
            draggable
            onDragStart={(e) => handleGroupDragStart(e, dac)}
          >
            <div className="dac-ip">{dac.hostName || dac.ip} ({dac.ip})</div>
            <div className="dac-channels">
              {dac.channels && dac.channels.length > 0 ? (
                dac.channels.map((channel) => (
                  <div
                    key={`${dac.unitID || dac.ip}-${channel.serviceID}`}
                    className={`dac-channel-item ${selectedDac && (selectedDac.unitID === dac.unitID || selectedDac.ip === dac.ip) && selectedDac.channel === channel.serviceID ? 'selected' : ''}`}
                    onClick={() => handleDacClick(dac, channel.serviceID)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, dac, channel.serviceID)}
                  >
                    Channel {channel.serviceID} ({channel.name})
                  </div>
                ))
              ) : (
                <div className="dac-channel-item no-channels">No channels found</div>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {dacs.length > 0 && (
          <div className="dac-dimmers-section">
            <h4>Channel Dimmers</h4>
            <div className="dac-dimmers-grid">
                {dacs.flatMap(dac => (dac.channels || []).map(ch => ({ dac, ch }))).map(({ dac, ch }) => {
                    const id = `${dac.ip}:${ch.serviceID}`;
                    const settings = dacSettings[id] || {};
                    const dimmerVal = settings.dimmer !== undefined ? settings.dimmer : 1;
                    
                    return (
                        <Mappable key={`dimmer_${id}`} id={`dimmer_${id.replace(/\./g, '_')}`}>
                            <RadialKnob
                                label={`${dac.hostName || dac.ip} Ch${ch.serviceID}`}
                                value={dimmerVal}
                                onChange={(val) => {
                                    if (onUpdateDacSettings) {
                                        onUpdateDacSettings(id, { ...settings, dimmer: val });
                                    }
                                }}
                            />
                        </Mappable>
                    );
                })}
            </div>
          </div>
      )}
    </div>
  );
};

export default DacPanel;
