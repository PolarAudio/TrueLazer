import React, { useState, useEffect, useCallback } from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';
import { initializeOsc, sendOscMessage, addOscMessageListener, closeOsc } from '../utils/osc';
import { DmxMonitor } from './DmxMonitor';

/**
 * ShortcutsWindow Component
 * A popup window for configuring MIDI, Art-Net, OSC, and Keyboard shortcuts.
 * @param {Object} props - Component props.
 * @param {boolean} props.show - Whether the window is visible.
 * @param {function} props.onClose - Callback to close the window.
 * @param {Object} props.enabledShortcuts - Object indicating which protocols are enabled.
 * @return {React.ReactElement} The ShortcutsWindow component.
 */
const ShortcutsWindow = ({ show, onClose, enabledShortcuts = {} }) => {
  const { 
    midiInitialized, 
    midiInputs, 
    selectedMidiInputId, 
    setSelectedMidiInputId, 
    isMapping, 
    startMapping, 
    stopMapping,
    learningId
  } = useMidi();

  const {
      artnetInitialized: globalArtnetInitialized,
      isMapping: isArtnetMapping,
      startMapping: startArtnetMapping,
      stopMapping: stopArtnetMapping,
      learningId: artnetLearningId,
      autoPatchFixedFootprint
  } = useArtnet() || {};

  const {
    isMapping: isKeyboardMapping,
    startMapping: startKeyboardMapping,
    stopMapping: stopKeyboardMapping,
    learningId: keyboardLearningId
  } = useKeyboard() || {};

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
    if (!show) return;

    // Load Universes if Art-Net is active
    const loadUniverses = async () => {
        if (globalArtnetInitialized && window.electronAPI.getArtnetUniverses) {
            const universes = await window.electronAPI.getArtnetUniverses();
            setArtnetUniverses(universes);
            if (universes.length > 0 && !selectedArtnetUniverseId) {
                setSelectedArtnetUniverseId(universes[0].id);
            }
        }
    };
    loadUniverses();

    // OSC Initialization (Local state for now as it's not in a context yet)
    const initOsc = async () => {
      if (!enabledShortcuts.osc) return () => {};
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
        } else {
          console.error("Failed to initialize OSC in main process:", result.error);
          setOscInitialized(false);
          return () => {};
        }
      } catch (err) {
        console.error("Failed to initialize OSC (renderer error):", err);
        setOscInitialized(false);
        return () => {};
      }
    };

    let cleanupOscListener = () => {};
    initOsc().then(cleanup => { 
        if (typeof cleanup === 'function') {
            cleanupOscListener = cleanup; 
        }
    });

    return () => {
      window.electronAPI.closeOsc(); 
      if (typeof cleanupOscListener === 'function') {
          cleanupOscListener(); 
      }
    };
  }, [show, oscLocalPort, oscRemoteAddress, oscRemotePort, enabledShortcuts, globalArtnetInitialized]);

  const handleMidiInputChange = (e) => {
    setSelectedMidiInputId(e.target.value);
  };

  const toggleMidiLearnMode = () => {
    if (isMapping) stopMapping();
    else startMapping();
  };

  const toggleArtnetLearnMode = () => {
    if (isArtnetMapping) stopArtnetMapping();
    else startArtnetMapping();
  };

  const toggleKeyboardLearnMode = () => {
    if (isKeyboardMapping) stopKeyboardMapping();
    else startKeyboardMapping();
  };

  const handleArtnetUniverseChange = (e) => {
    setSelectedArtnetUniverseId(e.target.value);
    const universeNumber = parseInt(e.target.value.replace('universe-', ''));
    if (window.electronAPI && window.electronAPI.listenArtnetUniverse) {
        window.electronAPI.listenArtnetUniverse(universeNumber);
    }
  };

  const handleArtnetChannelChange = (e) => {
    setArtnetChannel(parseInt(e.target.value));
  };

  const handleArtnetValueChange = (e) => {
    setArtnetValue(parseInt(e.target.value));
  };

  const handleSendArtnetData = () => {
    if (selectedArtnetUniverseId) {
      const universeNumber = parseInt(selectedArtnetUniverseId.replace('universe-', ''));
      window.electronAPI.sendArtnetData(universeNumber, artnetChannel, artnetValue);
    }
  };

  const handleOscSendMessage = () => {
    const args = oscSendMessageArgs.split(',').map(arg => {
      if (!isNaN(parseFloat(arg))) return parseFloat(arg);
      if (arg === 'true') return true;
      if (arg === 'false') return false;
      return arg.trim();
    });
    window.electronAPI.sendOscMessage(oscSendMessageAddress, args);
  };

  if (!show) return null;

  return (
    <div className="shortcuts-modal-overlay" style={{ pointerEvents: 'auto' }}>
      <div className="shortcuts-modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>Shortcuts Settings</h2>
            <button onClick={onClose} className="close-btn">×</button>
        </div>

        {enabledShortcuts.midi && (
        <div className="shortcuts-section">
          <h3>MIDI</h3>
          {!midiInitialized && <p>Initializing MIDI...</p>}
          {midiInitialized && (
            <div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                  <label htmlFor="midiInputSelect">Input:</label>
                  <select id="midiInputSelect" value={selectedMidiInputId} onChange={handleMidiInputChange} className="param-select" style={{ flex: 1 }}>
                    {midiInputs.map(input => (
                      <option key={input.id} value={input.id}>{input.name}</option>
                    ))}
                  </select>
                  <button onClick={toggleMidiLearnMode} style={{ backgroundColor: isMapping ? 'var(--theme-color)' : '', color: isMapping ? '#000' : '#fff' }}>
                    {isMapping ? 'Stop Mapping' : 'Start Mapping'}
                  </button>
              </div>
              {isMapping && <p style={{color: 'var(--theme-color)', fontSize: '11px'}}>Mapping Mode Active: Click a button to assign.</p>}
            </div>
          )}
        </div>
        )}

        {enabledShortcuts.artnet && (
        <div className="shortcuts-section">
          <h3>DMX/Artnet</h3>
          {!globalArtnetInitialized ? (
            <p>Initializing Art-Net...</p>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
                <label htmlFor="artnetUniverseSelect">Universe:</label>
                <select id="artnetUniverseSelect" value={selectedArtnetUniverseId} onChange={handleArtnetUniverseChange} className="param-select" style={{ flex: 1 }}>
                  {artnetUniverses.map(universe => (
                    <option key={universe.id} value={universe.id}>{universe.name}</option>
                  ))}
                </select>
                <button onClick={toggleArtnetLearnMode} style={{ backgroundColor: isArtnetMapping ? 'var(--theme-color)' : '', color: isArtnetMapping ? '#000' : '#fff' }}>
                  {isArtnetMapping ? 'Stop Mapping' : 'Start Mapping'}
                </button>
                <button onClick={autoPatchFixedFootprint} className="small-btn" title="Auto-patch standard 110-channel layout">
                    Auto-Patch
                </button>
              </div>

              <div style={{ borderTop: '1px solid #333', paddingTop: '10px', marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                    <h4>Test Output</h4>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '5px' }}>
                      <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '10px', color: '#888' }}>Channel</label>
                          <input type="number" min="0" max="511" value={artnetChannel} onChange={handleArtnetChannelChange} style={{ width: '100%' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '10px', color: '#888' }}>Value</label>
                          <input type="number" min="0" max="255" value={artnetValue} onChange={handleArtnetValueChange} style={{ width: '100%' }} />
                      </div>
                    </div>
                    <button onClick={handleSendArtnetData} style={{ width: '100%' }}>Send Data</button>
                </div>
                <div style={{ minHeight: '200px' }}>
                    <DmxMonitor />
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {enabledShortcuts.osc && (
        <div className="shortcuts-section">
          <h3>OSC</h3>
          {!oscInitialized ? <p>Initializing OSC...</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                  <h4>Configuration</h4>
                  <div className="param-editor">
                    <label>Local Port</label>
                    <input type="number" value={oscLocalPort} onChange={(e) => setOscLocalPort(parseInt(e.target.value))} />
                  </div>
                  <div className="param-editor">
                    <label>Remote IP</label>
                    <input type="text" value={oscRemoteAddress} onChange={(e) => setOscRemoteAddress(e.target.value)} />
                  </div>
                  <div className="param-editor">
                    <label>Remote Port</label>
                    <input type="number" value={oscRemotePort} onChange={(e) => setOscRemotePort(parseInt(e.target.value))} />
                  </div>
              </div>
              <div>
                  <h4>Test Send</h4>
                  <div className="param-editor">
                    <label>Address</label>
                    <input type="text" value={oscSendMessageAddress} onChange={(e) => setOscSendMessageAddress(e.target.value)} />
                  </div>
                  <div className="param-editor">
                    <label>Args</label>
                    <input type="text" value={oscSendMessageArgs} onChange={(e) => setOscSendMessageArgs(e.target.value)} />
                  </div>
                  <button onClick={handleOscSendMessage} style={{ width: '100%' }}>Send OSC</button>
                  
                  {lastOscMessage && (
                    <div className="last-event-status" style={{ marginTop: '10px' }}>
                        {lastOscMessage.address}: {JSON.stringify(lastOscMessage.args)}
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>
        )}

        {enabledShortcuts.keyboard && (
        <div className="shortcuts-section">
          <h3>Keyboard</h3>
          <button onClick={toggleKeyboardLearnMode} style={{ backgroundColor: isKeyboardMapping ? 'var(--theme-color)' : '', color: isKeyboardMapping ? '#000' : '#fff' }}>
            {isKeyboardMapping ? 'Stop Mapping' : 'Start Mapping'}
          </button>
        </div>
        )}

        <div style={{ marginTop: '20px', textAlign: 'right' }}>
            <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default ShortcutsWindow;
