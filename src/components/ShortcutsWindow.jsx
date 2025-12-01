import React, { useState, useEffect, useCallback } from 'react';
import { initializeMidi, getMidiInputs, listenToMidiInput, stopListeningToMidiInput } from '../utils/midi';
import { initializeArtnet, getArtnetUniverses, sendArtnetData, closeArtnet } from '../utils/artnet';
import { initializeOsc, sendOscMessage, addOscMessageListener, closeOsc } from '../utils/osc';

const ShortcutsWindow = ({ show, onClose }) => {
  const [midiInitialized, setMidiInitialized] = useState(false);
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState('');
  const [midiLearnMode, setMidiLearnMode] = useState(false);
  const [lastMidiEvent, setLastMidiEvent] = useState(null);

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

    const initMidi = async () => {
      try {
        await initializeMidi();
        setMidiInitialized(true);
        const inputs = getMidiInputs();
        setMidiInputs(inputs);
        if (inputs.length > 0) {
          setSelectedMidiInputId(inputs[0].id);
        }
      } catch (err) {
        console.error("Failed to initialize MIDI:", err);
        setMidiInitialized(false);
      }
    };

    const initArtnet = async () => {
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
    initMidi();
    initArtnet();
    initOsc().then(cleanup => { cleanupOscListener = cleanup; });

    return () => {
      if (selectedMidiInputId) {
        stopListeningToMidiInput(selectedMidiInputId);
      }
      window.electronAPI.closeArtnet();
      window.electronAPI.closeOsc(); // Use IPC to close OSC
      cleanupOscListener(); // Clean up OSC message listener
    };
  }, [show, selectedMidiInputId, oscLocalPort, oscRemoteAddress, oscRemotePort]);

  useEffect(() => {
    let cleanupListener = () => {};
    if (midiLearnMode && selectedMidiInputId) {
      cleanupListener = listenToMidiInput(selectedMidiInputId, (event) => {
        setLastMidiEvent(event);
        console.log("MIDI Event in Learn Mode:", event);
      });
    } else if (selectedMidiInputId) {
      stopListeningToMidiInput(selectedMidiInputId);
    }
    return cleanupListener;
  }, [midiLearnMode, selectedMidiInputId]);

  const handleMidiInputChange = (e) => {
    const newId = e.target.value;
    if (selectedMidiInputId) {
      stopListeningToMidiInput(selectedMidiInputId);
    }
    setSelectedMidiInputId(newId);
    setLastMidiEvent(null);
  };

  const toggleMidiLearnMode = () => {
    setMidiLearnMode(prev => !prev);
  };

  const handleArtnetUniverseChange = (e) => {
    setSelectedArtnetUniverseId(e.target.value);
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
              <button onClick={toggleMidiLearnMode}>
                {midiLearnMode ? 'Stop MIDI Learn' : 'Start MIDI Learn'}
              </button>
              {midiLearnMode && lastMidiEvent && (
                <p>Last MIDI Event: {lastMidiEvent.type} - {lastMidiEvent.note || lastMidiEvent.controller} (Value: {lastMidiEvent.value})</p>
              )}
              {midiLearnMode && !lastMidiEvent && (
                <p>Waiting for MIDI input...</p>
              )}
            </div>
          )}
        </div>

        <div className="shortcuts-section">
          <h3>DMX/Artnet</h3>
          {!artnetInitialized && <p>Initializing Art-Net...</p>}
          {artnetInitialized && artnetUniverses.length === 0 && <p>No Art-Net universes found (using placeholder).</p>}
          {artnetInitialized && artnetUniverses.length > 0 && (
            <div>
              <label htmlFor="artnetUniverseSelect">Select Art-Net Universe:</label>
              <select id="artnetUniverseSelect" value={selectedArtnetUniverseId} onChange={handleArtnetUniverseChange}>
                {artnetUniverses.map(universe => (
                  <option key={universe.id} value={universe.id}>{universe.name}</option>
                ))}
              </select>
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
          )}
        </div>

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

        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default ShortcutsWindow;
