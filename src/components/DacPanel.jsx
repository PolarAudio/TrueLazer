import React, { useState, useEffect } from 'react';
import RadialKnob from './RadialKnob';
import Mappable from './Mappable';

const DacPanel = ({ dacs = [], onDacSelected, onDacsDiscovered, dacSettings = {}, onUpdateDacSettings, onApplyGroup }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [selectedDac, setSelectedDac] = useState(null);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [selectedNetworkInterface, setSelectedNetworkInterface] = useState(null);
  const [groups, setGroups] = useState({});
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedForGroup, setSelectedForGroup] = useState([]); // Array of {ip, channel, type, hostName}
  const scanInProgressRef = React.useRef(false);

  useEffect(() => {
    // Load groups
    if (window.electronAPI && window.electronAPI.getDacGroups) {
        window.electronAPI.getDacGroups().then(setGroups);
    }
    // Load interfaces
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
    e.stopPropagation();
    const dacWithChannel = { ...dac, channel: channelId };
    e.dataTransfer.setData('application/json', JSON.stringify(dacWithChannel));
  };
  
  const handleNetworkInterfaceChange = (e) => {
    const selectedAddress = e.target.value;
    const iface = networkInterfaces.find(iface => iface.address === selectedAddress);
    setSelectedNetworkInterface(iface);
  };

  const handleGroupDragStart = (e, dac) => {
    e.stopPropagation();
    // When dragging the group, we pass all channels
    const dacWithAllChannels = { ...dac, allChannels: true };
    e.dataTransfer.setData('application/json', JSON.stringify(dacWithAllChannels));
  };

  const toggleDacSelection = (dac, channelId) => {
    const isSelected = selectedForGroup.some(item => item.ip === dac.ip && item.channel === channelId);
    if (isSelected) {
        setSelectedForGroup(selectedForGroup.filter(item => !(item.ip === dac.ip && item.channel === channelId)));
    } else {
        setSelectedForGroup([...selectedForGroup, { 
            ip: dac.ip, 
            channel: channelId, 
            type: dac.type, 
            hostName: dac.hostName,
            unitID: dac.unitID 
        }]);
    }
  };

  const saveGroup = async () => {
    if (!newGroupName.trim() || selectedForGroup.length === 0) return;
    const newGroups = { ...groups, [newGroupName.trim()]: selectedForGroup };
    setGroups(newGroups);
    if (window.electronAPI && window.electronAPI.saveDacGroups) {
        await window.electronAPI.saveDacGroups(newGroups);
    }
    setNewGroupName('');
    setSelectedForGroup([]);
  };

  const deleteGroup = async (name) => {
    const newGroups = { ...groups };
    delete newGroups[name];
    setGroups(newGroups);
    if (window.electronAPI && window.electronAPI.saveDacGroups) {
        await window.electronAPI.saveDacGroups(newGroups);
    }
  };

  const applyGroup = (groupData) => {
    if (onApplyGroup) {
        onApplyGroup(groupData);
    }
  };

  return (
    <div className="dac-panel">
      <div className="settings-card-header"><h4>DACs</h4></div>
      <div className="network-interface-selector" style={{display:'flex', gap:5, padding: '5px 10px'}}>
        <div style={{flex:1, display:'flex'}}>
            <select onChange={handleNetworkInterfaceChange} value={selectedNetworkInterface?.address || ''} style={{width:'100%', height:'100%', background:'#2a2a2a', color:'#aaa',borderRadius:'5px', cursor: 'pointer', marginBottom: 2}}>
              {networkInterfaces.map(iface => (
                <option key={iface.address} value={iface.address}>
                  {iface.name} ({iface.address})
                </option>
              ))}
            </select>
            <button 
                onClick={() => {
                     if (window.electronAPI) {
                        window.electronAPI.getNetworkInterfaces().then(interfaces => {
                            setNetworkInterfaces(interfaces);
                            if (interfaces.length > 0 && !selectedNetworkInterface) {
                                setSelectedNetworkInterface(interfaces[0]);
                            }
                        });
                     }
                }}
                style={{fontSize: '9px', padding: '2px', background: '#333', border: '1px solid #555', color: '#ccc', cursor: 'pointer', borderRadius: '5px'}}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-clockwise" viewBox="0 0 16 16">
					<path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
					<path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
				</svg>
            </button>
        </div>
        <label style={{display:'flex', alignItems:'center', fontSize: '10px'}}>
          <input type="checkbox" checked={isScanning} onChange={(e) => setIsScanning(e.target.checked)} disabled={isScanning} style={{ height: '100%'}} />
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
                dac.channels.map((channel) => {
                  const isSelectedForGroup = selectedForGroup.some(item => item.ip === dac.ip && item.channel === channel.serviceID);
                  return (
                    <div
                      key={`${dac.unitID || dac.ip}-${channel.serviceID}`}
                      className={`dac-channel-item ${selectedDac && (selectedDac.unitID === dac.unitID || selectedDac.ip === dac.ip) && selectedDac.channel === channel.serviceID ? 'selected' : ''}`}
                      onClick={() => handleDacClick(dac, channel.serviceID)}
                      draggable
                      onDragStart={(e) => handleDragStart(e, dac, channel.serviceID)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                    >
                      <input 
                        type="checkbox" 
                        checked={isSelectedForGroup} 
                        onChange={(e) => { e.stopPropagation(); toggleDacSelection(dac, channel.serviceID); }}
                        onClick={(e) => e.stopPropagation()} 
                      />
                      <span style={{ flex: 1 }}>Channel {channel.serviceID} ({channel.name})</span>
                    </div>
                  );
                })
              ) : (
                <div className="dac-channel-item no-channels">No channels found</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="dac-groups-section" style={{ padding: '10px', borderTop: '1px solid #444', marginTop: '10px' }}>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#888' }}>DAC Groups</h4>
        
        <div className="new-group-form" style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
            <input 
                type="text" 
                placeholder="Group Name..." 
                value={newGroupName} 
                onChange={(e) => setNewGroupName(e.target.value)}
                style={{ flex: 1, background: '#111', border: '1px solid #444', color: '#fff', fontSize: '11px', padding: '2px 5px', borderRadius: '3px' }}
            />
            <button 
                onClick={saveGroup}
                disabled={!newGroupName.trim() || selectedForGroup.length === 0}
                style={{ fontSize: '10px', padding: '2px 8px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px', cursor: 'pointer' }}
            >Save</button>
        </div>

        <div className="groups-list">
            {Object.entries(groups).map(([name, groupDacs]) => (
                <div key={name} className="group-item" style={{ display: 'flex', alignItems: 'center', background: '#2a2a2a', padding: '4px 8px', borderRadius: '4px', marginBottom: '4px', fontSize: '11px' }}>
                    <span style={{ flex: 1 }}>{name} ({groupDacs.length})</span>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <button 
                            onClick={() => applyGroup(groupDacs)}
                            style={{ background: 'var(--theme-color)', border: 'none', color: '#000', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                        >Apply</button>
                        <button 
                            onClick={() => deleteGroup(name)}
                            style={{ background: '#444', border: 'none', color: '#ccc', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                        >×</button>
                    </div>
                </div>
            ))}
            {Object.keys(groups).length === 0 && (
                <div style={{ fontSize: '10px', color: '#666', fontStyle: 'italic' }}>No groups defined.</div>
            )}
        </div>
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
