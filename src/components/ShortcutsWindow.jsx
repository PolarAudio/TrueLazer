import React, { useState, useEffect, useCallback } from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';
import { initializeArtnet, getArtnetUniverses, sendArtnetData, closeArtnet } from '../utils/artnet';
import { initializeOsc, sendOscMessage, addOscMessageListener, closeOsc } from '../utils/osc';

const ShortcutsWindow = ({ show, onClose, enabledShortcuts = {} }) => {
  const { 
    midiInitialized, 
    midiInputs, 
    selectedMidiInputId, 
    setSelectedMidiInputId, 
    isMapping, 
    startMapping, 
    stopMapping,
    learningId // Optional: could show what is currently being learned
  } = useMidi();

  const {
      isMapping: isArtnetMapping,
      startMapping: startArtnetMapping,
      stopMapping: stopArtnetMapping,
      learningId: artnetLearningId
  } = useArtnet() || {};

  const {
    isMapping: isKeyboardMapping,
    startMapping: startKeyboardMapping,
    stopMapping: stopKeyboardMapping,
    learningId: keyboardLearningId
  } = useKeyboard() || {};

  const [artnetInitialized, setArtnetInitialized] = useState(false);
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

    // MIDI Init is handled by Context now

    const initArtnet = async () => {
      if (!enabledShortcuts.artnet) return;
      try {
        const result = await window.electronAPI.initializeArtnet();
        if (result.success) {
          setArtnetInitialized(true);
          const universes = await window.electronAPI.getArtnetUniverses();
          setArtnetUniverses(universes);
          if (universes.length > 0) {
            setSelectedArtnetUniverseId(universes[0].id);
          }
        } else {
          console.error("Failed to initialize Art-Net in main process:", result.error);
          setArtnetInitialized(false);
        }
      } catch (err) {
        console.error("Failed to initialize Art-Net (renderer error):", err);
        setArtnetInitialized(false);
      }
    };

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
          // Set up listener for incoming OSC messages from the main process
          const cleanupListener = window.electronAPI.onOscMessageReceived(({ oscMessage }) => {
            setLastOscMessage(oscMessage);
          });
          return cleanupListener; // Return cleanup function for the listener
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
    initArtnet();
    initOsc().then(cleanup => { 
        if (typeof cleanup === 'function') {
            cleanupOscListener = cleanup; 
        }
    });

    return () => {
      // Only close if we opened them, but it's safe to call close always
      window.electronAPI.closeArtnet();
      window.electronAPI.closeOsc(); // Use IPC to close OSC
      if (typeof cleanupOscListener === 'function') {
          cleanupOscListener(); // Clean up OSC message listener
      }
    };
  }, [show, oscLocalPort, oscRemoteAddress, oscRemotePort, enabledShortcuts]);

  const handleMidiInputChange = (e) => {
    setSelectedMidiInputId(e.target.value);
  };

  const toggleMidiLearnMode = () => {
    if (isMapping) {
        stopMapping();
    } else {
        startMapping();
    }
  };

  const toggleArtnetLearnMode = () => {
    if (isArtnetMapping) {
        stopArtnetMapping();
    } else {
        startArtnetMapping();
    }
  };

  const toggleKeyboardLearnMode = () => {
    if (isKeyboardMapping) {
        stopKeyboardMapping();
    } else {
        startKeyboardMapping();
    }
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
      console.log(`Sent Art-Net data: Universe ${universeNumber}, Channel ${artnetChannel}, Value ${artnetValue}`);
    } else {
      console.warn("No Art-Net universe selected.");
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

  if (!show) {
    return null;
  }

  return (
    <div className="shortcuts-modal-overlay">
      <div className="shortcuts-modal-content">
        <h2>Shortcuts Settings</h2>

        {enabledShortcuts.midi && (
        <div className="shortcuts-section">
          <h3>MIDI</h3>
          {!midiInitialized && <p>Initializing MIDI...</p>}
          {midiInitialized && midiInputs.length === 0 && <p>No MIDI input devices found.</p>}
          {midiInitialized && midiInputs.length > 0 && (
            <div>
              <label htmlFor="midiInputSelect">Select MIDI Input:</label>
              <select id="midiInputSelect" value={selectedMidiInputId} onChange={handleMidiInputChange}>
                {midiInputs.map(input => (
                  <option key={input.id} value={input.id}>{input.name}</option>
                ))}
              </select>
              <button onClick={toggleMidiLearnMode} style={{ marginLeft: '10px', backgroundColor: isMapping ? 'var(--theme-color)' : '' }}>
                {isMapping ? 'Stop Mapping' : 'Start Mapping'}
              </button>
              {isMapping && (
                 <p style={{color: 'var(--theme-color)'}}>Mapping Mode Active: Click a button to assign.</p>
              )}
              {learningId && (
                  <p style={{color: 'yellow'}}>Waiting for MIDI input for selected control...</p>
              )}
            </div>
          )}
        </div>
        )}

        {enabledShortcuts.artnet && (
        <div className="shortcuts-section">
          <h3>DMX/Artnet</h3>
          {!artnetInitialized && <p>Initializing Art-Net...</p>}
          {artnetInitialized && artnetUniverses.length === 0 && <p>No Art-Net universes found (using placeholder).</p>}
          {artnetInitialized && artnetUniverses.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
                <label htmlFor="artnetUniverseSelect" style={{ marginRight: '10px' }}>Select Art-Net Universe:</label>
                <select id="artnetUniverseSelect" value={selectedArtnetUniverseId} onChange={handleArtnetUniverseChange}>
                  {artnetUniverses.map(universe => (
                    <option key={universe.id} value={universe.id}>{universe.name}</option>
                  ))}
                </select>
                <button onClick={toggleArtnetLearnMode} style={{ marginLeft: '10px', backgroundColor: isArtnetMapping ? 'var(--theme-color)' : '' }}>
                  {isArtnetMapping ? 'Stop Mapping' : 'Start Mapping'}
                </button>
              </div>

              {isArtnetMapping && (
                 <p style={{color: 'var(--theme-color)'}}>DMX Mapping Mode Active: Click a button/slider to assign.</p>
              )}
              {artnetLearningId && (
                  <p style={{color: 'yellow'}}>Waiting for DMX input for selected control...</p>
              )}

              <div style={{ borderTop: '1px solid #444', paddingTop: '10px', marginTop: '10px' }}>
                <h4>Test Output</h4>
                <div>
                  <label htmlFor="artnetChannel">Channel:</label>
                  <input type="number" id="artnetChannel" min="0" max="511" value={artnetChannel} onChange={handleArtnetChannelChange} />
                </div>
                <div>
                  <label htmlFor="artnetValue">Value:</label>
                  <input type="number" id="artnetValue" min="0" max="255" value={artnetValue} onChange={handleArtnetValueChange} />
                </div>
                <button onClick={handleSendArtnetData}>Send Art-Net Data</button>
              </div>
            </div>
          )}
        </div>
        )}

        {enabledShortcuts.osc && (
        <div className="shortcuts-section">
          <h3>OSC</h3>
          {!oscInitialized && <p>Initializing OSC...</p>}
          {oscInitialized && (
            <div>
              <h4>Configuration</h4>
              <div>
                <label htmlFor="oscLocalPort">Local Port:</label>
                <input type="number" id="oscLocalPort" value={oscLocalPort} onChange={(e) => setOscLocalPort(parseInt(e.target.value))} />
              </div>
              <div>
                <label htmlFor="oscRemoteAddress">Remote IP:</label>
                <input type="text" id="oscRemoteAddress" value={oscRemoteAddress} onChange={(e) => setOscRemoteAddress(e.target.value)} />
              </div>
              <div>
                <label htmlFor="oscRemotePort">Remote Port:</label>
                <input type="number" id="oscRemotePort" value={oscRemotePort} onChange={(e) => setOscRemotePort(parseInt(e.target.value))} />
              </div>

              <h4>Send Message</h4>
              <div>
                <label htmlFor="oscAddress">Address:</label>
                <input type="text" id="oscAddress" value={oscSendMessageAddress} onChange={(e) => setOscSendMessageAddress(e.target.value)} />
              </div>
              <div>
                <label htmlFor="oscArgs">Arguments (comma-separated):</label>
                <input type="text" id="oscArgs" value={oscSendMessageArgs} onChange={(e) => setOscSendMessageArgs(e.target.value)} />
              </div>
              <button onClick={handleOscSendMessage}>Send OSC Message</button>

              <h4>Last Received Message</h4>
              {lastOscMessage ? (
                <p>Address: {lastOscMessage.address}, Args: {JSON.stringify(lastOscMessage.args)}</p>
              ) : (
                <p>Waiting for OSC messages...</p>
              )}
            </div>
          )}
        </div>
        )}

        {enabledShortcuts.keyboard && (
        <div className="shortcuts-section">
          <h3>Keyboard</h3>
          <div>
            <button onClick={toggleKeyboardLearnMode} style={{ backgroundColor: isKeyboardMapping ? 'var(--theme-color)' : '' }}>
              {isKeyboardMapping ? 'Stop Mapping' : 'Start Mapping'}
            </button>
            {isKeyboardMapping && (
                <p style={{color: 'var(--theme-color)'}}>Keyboard Mapping Mode Active: Click a control to assign.</p>
            )}
            {keyboardLearningId && (
                <p style={{color: 'yellow'}}>Waiting for keyboard input for selected control...</p>
            )}
          </div>
        </div>
        )}

        {(!enabledShortcuts.midi && !enabledShortcuts.artnet && !enabledShortcuts.osc && !enabledShortcuts.keyboard) && (
            <p>No shortcut protocols are enabled. Enable them in the Shortcuts menu.</p>
        )}

        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default ShortcutsWindow;
