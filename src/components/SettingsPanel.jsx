import React, { useState, useEffect } from 'react';
import EffectEditor from './EffectEditor';
import GeneratorSettingsPanel from './GeneratorSettingsPanel';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';

const SettingsPanel = ({
  effects,
  assignedDacs = [],
  onRemoveDac,
  audioFile,
  onAssignAudio,
  onRemoveAudio,
  audioInfo,
  onParameterChange,
  selectedLayerIndex,
  selectedColIndex,
  selectedGeneratorId,
  selectedGeneratorParams,
  onGeneratorParameterChange,
  enabledShortcuts = {}
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
  const [artnetChannel, setArtnetChannel] = useState(0);
  const [artnetValue, setArtnetValue] = useState(0);

  const [oscInitialized, setOscInitialized] = useState(false);
  const [oscLocalPort, setOscLocalPort] = useState(57121);
  const [oscRemoteAddress, setOscRemoteAddress] = useState("127.0.0.1");
  const [oscRemotePort, setOscRemotePort] = useState(57120);
  const [oscSendMessageAddress, setOscSendMessageAddress] = useState("/test");
  const [oscSendMessageArgs, setOscSendMessageArgs] = useState("hello");
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

  const hasEffects = effects && effects.length > 0;
  const hasGenerator = !!selectedGeneratorId;
  const hasAssignedDacs = assignedDacs && assignedDacs.length > 0;

  // Calculate audio progress percentage
  const audioProgress = audioInfo && audioInfo.duration 
    ? (audioInfo.currentTime / audioInfo.duration) * 100 
    : 0;

  return (
    <div className="settings-panel">
      <h3>Settings</h3>

      {/* Shortcuts Settings Section */}
      {(enabledShortcuts.midi || enabledShortcuts.artnet || enabledShortcuts.osc) && (
        <div className="shortcuts-settings-panel">
          {enabledShortcuts.midi && (
            <div className="settings-section">
              <h4>MIDI Shortcuts</h4>
              {!midiInitialized ? (
                <p>Initializing MIDI...</p>
              ) : (
                <div className="midi-config">
                  <select value={selectedMidiInputId} onChange={handleMidiInputChange}>
                    {midiInputs.map(input => (
                      <option key={input.id} value={input.id}>{input.name}</option>
                    ))}
                  </select>
                  <div className="button-row">
                    <button 
                        className={`mapping-btn ${isMapping ? 'active' : ''}`} 
                        onClick={toggleMidiLearnMode}
                        style={{ backgroundColor: isMapping ? 'var(--theme-color)' : '' }}
                    >
                        {isMapping ? 'Stop Mapping' : 'Start Mapping'}
                    </button>
                    <button className="save-mapping-btn" onClick={saveMappings} title="Save to internal storage">Save Default</button>
                    <button className="save-mapping-btn" onClick={exportMidiMappings}>Save as...</button>
                    <button className="load-mapping-btn" onClick={importMidiMappings}>Load</button>
                    <button className="clear-mapping-btn" onClick={() => setMappings({})}>Clear All</button>
                  </div>
                  {lastMidiEvent && (
                      <div className="last-midi-status">
                          Last Signal: {lastMidiEvent.type} {lastMidiEvent.note || lastMidiEvent.controller} (CH{lastMidiEvent.channel})
                      </div>
                  )}
                </div>
              )}
            </div>
          )}

          {enabledShortcuts.artnet && (
            <div className="settings-section">
              <h4>ArtNet Shortcuts</h4>
              {!artnetInitialized ? (
                <p>Initializing Art-Net...</p>
              ) : (
                <div className="artnet-config">
                  <select 
                    value={selectedArtnetUniverseId} 
                    onChange={(e) => {
                        setSelectedArtnetUniverseId(e.target.value);
                        const universeNumber = parseInt(e.target.value.replace('universe-', ''));
                        if (window.electronAPI && window.electronAPI.listenArtnetUniverse) {
                            window.electronAPI.listenArtnetUniverse(universeNumber);
                        }
                    }}
                  >
                    {artnetUniverses.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <div className="button-row">
                    <button 
                        className={`mapping-btn ${isArtnetMapping ? 'active' : ''}`} 
                        onClick={toggleArtnetLearnMode}
                        style={{ backgroundColor: isArtnetMapping ? 'var(--theme-color)' : '' }}
                    >
                        {isArtnetMapping ? 'Stop Mapping' : 'Start Mapping'}
                    </button>
                    <button className="save-mapping-btn" onClick={saveArtnetMappings} title="Save to internal storage">Save Default</button>
                    <button className="save-mapping-btn" onClick={exportArtnetMappings}>Save as...</button>
                    <button className="load-mapping-btn" onClick={importArtnetMappings}>Load</button>
                    <button className="clear-mapping-btn" onClick={() => setArtnetMappings({})}>Clear All</button>
                  </div>
                  {lastDmxEvent && (
                      <div className="last-midi-status">
                          Last Signal: Universe {lastDmxEvent.universe} CH {lastDmxEvent.channel + 1} (Val: {lastDmxEvent.value})
                      </div>
                  )}
                </div>
              )}
            </div>
          )}

          {enabledShortcuts.osc && (
            <div className="settings-section">
              <h4>OSC Shortcuts</h4>
              <div className="osc-config">
                <p>Listening on port: {oscLocalPort}</p>
                {/* OSC mapping controls will go here */}
              </div>
            </div>
          )}
        </div>
      )}
      
      {selectedLayerIndex !== null && selectedColIndex !== null ? (
        <>
          <div className="audio-settings-section">
              <h4>Audio</h4>
              {audioFile ? (
                  <div className="assigned-audio-info">
                      <div className="audio-file-name" title={audioFile.path}>{audioFile.name}</div>
                      <div className="audio-progress-container">
                          <div className="audio-progress-bar" style={{ width: `${audioProgress}%` }}></div>
                      </div>
                      <div className="audio-time-info">
                          {audioInfo ? `${audioInfo.currentTime.toFixed(1)}s / ${audioInfo.duration.toFixed(1)}s` : '0.0s / 0.0s'}
                      </div>
                      <button className="remove-audio-btn" onClick={onRemoveAudio}>Remove Audio</button>
                  </div>
              ) : (
                  <button className="assign-audio-btn" onClick={onAssignAudio}>Assign Audio File</button>
              )}
          </div>

          {hasAssignedDacs && (
            <div className="assigned-dacs-settings">
              <h4>Assigned DACs</h4>
              <ul className="assigned-dacs-list">
                {assignedDacs.map((dac, index) => (
                  <li key={`${dac.unitID || dac.ip}-${dac.channel}-${index}`} className="assigned-dac-item">
                    <span>{dac.hostName || dac.ip} - Ch {dac.channel}</span>
                    <button className="remove-dac-btn" onClick={() => onRemoveDac(index)}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasGenerator && (
            <GeneratorSettingsPanel
              selectedGeneratorId={selectedGeneratorId}
              selectedGeneratorParams={selectedGeneratorParams}
              onParameterChange={onGeneratorParameterChange}
            />
          )}

          {hasEffects && effects.map((effect, effectIndex) => (
            <EffectEditor
              key={effect.id + effectIndex} // More robust key
              effect={effect}
              // Correctly pass parameters to the handler from App.jsx
              onParamChange={(paramId, paramValue) => 
                onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, paramId, paramValue)
              }
            />
          ))}

          {!hasGenerator && !hasEffects && (
            <p>No settings to display for the selected clip.</p>
          )}
        </>
      ) : (
        <p>Select a clip to view settings.</p>
      )}
    </div>
  );
};

export default SettingsPanel;
