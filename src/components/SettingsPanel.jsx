import React, { useState, useEffect } from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';
import GlobalQuickAssigns from './GlobalQuickAssigns';
import CollapsiblePanel from './CollapsiblePanel';

const SettingsPanel = ({
  enabledShortcuts = {},
  onOpenOutputSettings,
  quickAssigns,
  onUpdateKnob,
  onToggleButton,
  onAssign,
  renderSettings = {},
  onSetRenderSetting
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

  const collapsedStates = renderSettings.settingsPanelCollapsed || {};

  const handleToggle = (id, val) => {
    if (onSetRenderSetting) {
        onSetRenderSetting('settingsPanelCollapsed', {
            ...collapsedStates,
            [id]: val
        });
    }
  };

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

  const {
    isMapping: isKeyboardMapping,
    startMapping: startKeyboardMapping,
    stopMapping: stopKeyboardMapping,
    setMappings: setKeyboardMappings,
    saveMappings: saveKeyboardMappings,
    exportMappings: exportKeyboardMappings,
    importMappings: importKeyboardMappings
  } = useKeyboard() || {};

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
  const toggleKeyboardLearnMode = () => isKeyboardMapping ? stopKeyboardMapping() : startKeyboardMapping();

  return (
    <div className="settings-panel settings-panel-base">
      <div className="settings-card-header"><h4>Global Settings</h4></div>

      {quickAssigns && (
          <CollapsiblePanel 
            title="Quick Assigns"
            isCollapsed={!!collapsedStates['quickAssigns']}
            onToggle={(val) => handleToggle('quickAssigns', val)}
          >
              <GlobalQuickAssigns 
                  assigns={quickAssigns}
                  onUpdateKnob={onUpdateKnob}
                  onToggleButton={onToggleButton}
                  onAssign={onAssign}
              />
          </CollapsiblePanel>
      )}

      {/* Channel/DAC Settings Placeholder */}
      <CollapsiblePanel 
        title="Channel/DAC Settings"
        isCollapsed={!!collapsedStates['dacSettings']}
        onToggle={(val) => handleToggle('dacSettings', val)}
      >
          <p className="info-text">Output routing and safety zones configuration.</p>
          <button className="small-btn" style={{width:'100%', marginTop:'5px'}} onClick={onOpenOutputSettings}>Open Output Settings</button>
      </CollapsiblePanel>

      {/* Shortcuts Settings Section */}
      {(enabledShortcuts.midi || enabledShortcuts.artnet || enabledShortcuts.osc || enabledShortcuts.keyboard) && (
        <div className="shortcuts-settings-panel">
          {enabledShortcuts.keyboard && (
            <CollapsiblePanel 
                title="Keyboard Shortcuts"
                isCollapsed={!!collapsedStates['keyboard']}
                onToggle={(val) => handleToggle('keyboard', val)}
            >
                <div className="keyboard-config">
                    <div className="button-grid">
                      <button 
                          className={`mapping-btn ${isKeyboardMapping ? 'active' : ''}`} 
                          onClick={toggleKeyboardLearnMode}
                          style={{ backgroundColor: isKeyboardMapping ? 'var(--theme-color)' : '', gridColumn: 'span 2' }}
                      >
                          {isKeyboardMapping ? 'Stop Mapping' : 'Start Mapping'}
                      </button>
                      <button className="small-btn" onClick={saveKeyboardMappings}>Save Default</button>
                      <button className="small-btn" onClick={exportKeyboardMappings}>Export</button>
                      <button className="small-btn" onClick={importKeyboardMappings}>Import</button>
                      <button className="small-btn clear" onClick={() => setKeyboardMappings({})}>Clear</button>
                    </div>
                    <p className="info-text" style={{fontSize: '9px', color: '#666', marginTop: '5px'}}>
                        Assign keys to buttons/sliders by activating "Start Mapping" and clicking a control.
                    </p>
                </div>
            </CollapsiblePanel>
          )}
          {enabledShortcuts.midi && (
            <CollapsiblePanel 
                title="MIDI Shortcuts"
                isCollapsed={!!collapsedStates['midi']}
                onToggle={(val) => handleToggle('midi', val)}
            >
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
            </CollapsiblePanel>
          )}

          {enabledShortcuts.artnet && (
            <CollapsiblePanel 
                title="ArtNet Shortcuts"
                isCollapsed={!!collapsedStates['artnet']}
                onToggle={(val) => handleToggle('artnet', val)}
            >
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
            </CollapsiblePanel>
          )}

          {enabledShortcuts.osc && (
            <CollapsiblePanel 
                title="OSC Shortcuts"
                isCollapsed={!!collapsedStates['osc']}
                onToggle={(val) => handleToggle('osc', val)}
            >
                <div className="osc-config">
                  <p className="info-text">Listening on port: {oscLocalPort}</p>
                </div>
            </CollapsiblePanel>
          )}
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
