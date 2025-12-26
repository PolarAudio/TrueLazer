import React, { useState, useEffect } from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import GlobalQuickAssigns from './GlobalQuickAssigns';

const SettingsPanel = ({
  enabledShortcuts = {},
  onOpenOutputSettings,
  quickAssigns,
  onUpdateKnob,
  onToggleButton,
  onAssign
}) => {
  const { 
    midiInitialized, 
    midiInputs, 
    selectedMidiInputId, 
    setSelectedMidiInputId, 
    isMapping, 
    startMapping, 
    stopMapping,
    learningId,
    lastMidiEvent,
    setMappings,
    saveMappings,
    exportMappings: exportMidiMappings,
    importMappings: importMidiMappings
  } = useMidi();

  const { 
    artnetInitialized,
    isMapping: isArtnetMapping,
    startMapping: startArtnetMapping,
    stopMapping: stopArtnetMapping,
    setMappings: setArtnetMappings,
    saveMappings: saveArtnetMappings,
    exportMappings: exportArtnetMappings,
    importMappings: importArtnetMappings,
    lastDmxEvent
  } = useArtnet() || {};

  const [artnetUniverses, setArtnetUniverses] = useState([]);
  const [selectedArtnetUniverseId, setSelectedArtnetUniverseId] = useState('');

  const [oscInitialized, setOscInitialized] = useState(false);
  const [oscLocalPort, setOscLocalPort] = useState(57121);
  const [oscRemoteAddress, setOscRemoteAddress] = useState("127.0.0.1");
  const [oscRemotePort, setOscRemotePort] = useState(57120);
  const [lastOscMessage, setLastOscMessage] = useState(null);

  useEffect(() => {
    const fetchArtnetUniverses = async () => {
      if (!enabledShortcuts.artnet) return;
      try {
        const universes = await window.electronAPI.getArtnetUniverses();
        setArtnetUniverses(universes);
        if (universes.length > 0) {
          setSelectedArtnetUniverseId(universes[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch Art-Net universes:", err);
      }
    };

    const initOsc = async () => {
      if (!enabledShortcuts.osc) return;
      try {
        const result = await window.electronAPI.initializeOsc({
          localPort: oscLocalPort,
          remoteAddress: oscRemoteAddress,
          remotePort: oscRemotePort,
        });
        if (result.success) {
          setOscInitialized(true);
          const cleanupListener = window.electronAPI.onOscMessageReceived(({ oscMessage }) => {
            setLastOscMessage(oscMessage);
          });
          return cleanupListener;
        }
      } catch (err) {
        console.error("Failed to initialize OSC:", err);
      }
    };

    let cleanupOscListener = () => {};
    fetchArtnetUniverses();
    initOsc().then(cleanup => { 
        if (typeof cleanup === 'function') cleanupOscListener = cleanup; 
    });

    return () => {
      if (typeof cleanupOscListener === 'function') cleanupOscListener();
    };
  }, [enabledShortcuts]);

  const handleMidiInputChange = (e) => setSelectedMidiInputId(e.target.value);
  const toggleMidiLearnMode = () => isMapping ? stopMapping() : startMapping();
  const toggleArtnetLearnMode = () => isArtnetMapping ? stopArtnetMapping() : startArtnetMapping();

  return (
    <div className="settings-panel settings-panel-base">
      <h3>Global Settings</h3>

      {quickAssigns && (
          <div className="settings-card quick-assigns-card">
              <div className="settings-card-header">
                  <h4>Quick Assigns</h4>
              </div>
              <div className="settings-card-content">
                  <GlobalQuickAssigns 
                      assigns={quickAssigns}
                      onUpdateKnob={onUpdateKnob}
                      onToggleButton={onToggleButton}
                      onAssign={onAssign}
                  />
              </div>
          </div>
      )}

      {/* Channel/DAC Settings Placeholder */}
      <div className="settings-card">
        <div className="settings-card-header">
          <h4>Channel/DAC Settings</h4>
        </div>
        <div className="settings-card-content">
          <p className="info-text">Output routing and safety zones configuration.</p>
          <button className="small-btn" style={{width:'100%', marginTop:'5px'}} onClick={onOpenOutputSettings}>Open Output Settings</button>
        </div>
      </div>

      {/* Shortcuts Settings Section */}
      {(enabledShortcuts.midi || enabledShortcuts.artnet || enabledShortcuts.osc) && (
        <div className="shortcuts-settings-panel">
          {enabledShortcuts.midi && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h4>MIDI Shortcuts</h4>
              </div>
              <div className="settings-card-content">
                {!midiInitialized ? (
                  <p className="loading-text">Initializing MIDI...</p>
                ) : (
                  <div className="midi-config">
                    <select className="param-select" value={selectedMidiInputId} onChange={handleMidiInputChange} style={{ marginBottom: '8px', width: '100%' }}>
                      {midiInputs.map(input => (
                        <option key={input.id} value={input.id}>{input.name}</option>
                      ))}
                    </select>
                    <div className="button-grid">
                      <button 
                          className={`mapping-btn ${isMapping ? 'active' : ''}`} 
                          onClick={toggleMidiLearnMode}
                          style={{ backgroundColor: isMapping ? 'var(--theme-color)' : '', gridColumn: 'span 2' }}
                      >
                          {isMapping ? 'Stop Mapping' : 'Start Mapping'}
                      </button>
                      <button className="small-btn" onClick={saveMappings}>Save Default</button>
                      <button className="small-btn" onClick={exportMidiMappings}>Export</button>
                      <button className="small-btn" onClick={importMidiMappings}>Import</button>
                      <button className="small-btn clear" onClick={() => setMappings({})}>Clear</button>
                    </div>
                    {lastMidiEvent && (
                        <div className="last-event-status">
                            {lastMidiEvent.type} {lastMidiEvent.note || lastMidiEvent.controller} (CH{lastMidiEvent.channel})
                        </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {enabledShortcuts.artnet && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h4>ArtNet Shortcuts</h4>
              </div>
              <div className="settings-card-content">
                {!artnetInitialized ? (
                  <p className="loading-text">Initializing Art-Net...</p>
                ) : (
                  <div className="artnet-config">
                    <select 
                      className="param-select"
                      value={selectedArtnetUniverseId} 
                      onChange={(e) => {
                          setSelectedArtnetUniverseId(e.target.value);
                          const universeNumber = parseInt(e.target.value.replace('universe-', ''));
                          if (window.electronAPI && window.electronAPI.listenArtnetUniverse) {
                              window.electronAPI.listenArtnetUniverse(universeNumber);
                          }
                      }}
                      style={{ marginBottom: '8px', width: '100%' }}
                    >
                      {artnetUniverses.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <div className="button-grid">
                      <button 
                          className={`mapping-btn ${isArtnetMapping ? 'active' : ''}`} 
                          onClick={toggleArtnetLearnMode}
                          style={{ backgroundColor: isArtnetMapping ? 'var(--theme-color)' : '', gridColumn: 'span 2' }}
                      >
                          {isArtnetMapping ? 'Stop Mapping' : 'Start Mapping'}
                      </button>
                      <button className="small-btn" onClick={saveArtnetMappings}>Save Default</button>
                      <button className="small-btn" onClick={exportArtnetMappings}>Export</button>
                      <button className="small-btn" onClick={importArtnetMappings}>Import</button>
                      <button className="small-btn clear" onClick={() => setArtnetMappings({})}>Clear</button>
                    </div>
                    {lastDmxEvent && (
                        <div className="last-event-status">
                            UNIV {lastDmxEvent.universe} CH {lastDmxEvent.channel + 1} (Val: {lastDmxEvent.value})
                        </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {enabledShortcuts.osc && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h4>OSC Shortcuts</h4>
              </div>
              <div className="settings-card-content">
                <div className="osc-config">
                  <p className="info-text">Listening on port: {oscLocalPort}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;