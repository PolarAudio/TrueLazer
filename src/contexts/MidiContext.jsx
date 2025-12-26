import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { initializeMidi, getMidiInputs, listenToMidiInput, stopListeningToMidiInput, sendSysex, sendNote } from '../utils/midi';

const MidiContext = createContext(null);

export const useMidi = () => {
  return useContext(MidiContext);
};

export const MidiProvider = ({ children, onMidiCommand }) => {
  const [midiInitialized, setMidiInitialized] = useState(false);
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState('');
  const [isMapping, setIsMapping] = useState(false); // Global flag for "Mapping Mode"
  const [learningId, setLearningId] = useState(null); // ID of the specific element waiting for input
  const [mappings, setMappings] = useState({}); // { controlId: { type: 'note'|'cc', channel, address, requiresShift, label } }
  const [lastMidiEvent, setLastMidiEvent] = useState(null);
  const [isShiftDown, setIsShiftDown] = useState(false);
  const isShiftDownRef = useRef(false);

  // Keep latest reference of onMidiCommand to avoid stale closures in event listener
  const onMidiCommandRef = useRef(onMidiCommand);
  useEffect(() => {
    onMidiCommandRef.current = onMidiCommand;
  }, [onMidiCommand]);

  // Initialize MIDI and Load Mappings
  useEffect(() => {
    const init = async () => {
      try {
        await initializeMidi();
        setMidiInitialized(true);
        const inputs = getMidiInputs();
        setMidiInputs(inputs);
        
        if (window.electronAPI && window.electronAPI.getSelectedMidiInput) {
            const savedInputId = await window.electronAPI.getSelectedMidiInput();
            if (savedInputId && inputs.some(i => i.id === savedInputId)) {
                setSelectedMidiInputId(savedInputId);
            } else if (inputs.length > 0) {
                if (!selectedMidiInputId) setSelectedMidiInputId(inputs[0].id);
            }
        } else if (inputs.length > 0) {
           if (!selectedMidiInputId) setSelectedMidiInputId(inputs[0].id);
        }

        // Load saved mappings from store
        if (window.electronAPI && window.electronAPI.getMidiMappings) {
            const savedMappings = await window.electronAPI.getMidiMappings();
            if (savedMappings) {
                console.log("Loaded saved MIDI mappings:", savedMappings);
                setMappings(savedMappings);
            }
        }
      } catch (err) {
        console.error("MIDI Init Failed:", err);
      }
    };
    init();
  }, []);

  const saveMappings = async () => {
      if (window.electronAPI && window.electronAPI.saveMidiMappings) {
          await window.electronAPI.saveMidiMappings(mappings);
          console.log("MIDI mappings saved to default.");
      }
  };

  const exportMappings = async () => {
      if (window.electronAPI && window.electronAPI.exportMappings) {
          await window.electronAPI.exportMappings(mappings, 'midi');
      }
  };

  const importMappings = async () => {
      if (window.electronAPI && window.electronAPI.importMappings) {
          const result = await window.electronAPI.importMappings('midi');
          if (result.success && result.mappings) {
              setMappings(result.mappings);
              console.log("MIDI mappings imported.");
          }
      }
  };

  // APC40 Handshake / Initialization
  const initializeApc40 = (inputId) => {
    const input = midiInputs.find(i => i.id === inputId);
    if (input && input.name.toLowerCase().includes('apc40')) {
        console.log("Detected APC40, sending initialization SysEx...");
        // SysEx for APC40 Mk2 Mode Change:
        // F0 47 7F 29 60 00 04 41 [VersionHigh] [VersionLow] [VersionBugfix] F7
        // 0x41 is Mode 1 (Ableton Live Mode)
        const initData = [0x7F, 0x29, 0x60, 0x00, 0x04, 0x41, 0x01, 0x01, 0x01];
        sendSysex(inputId, initData);
    }
  };

  useEffect(() => {
    if (selectedMidiInputId && window.electronAPI && window.electronAPI.saveSelectedMidiInput) {
        window.electronAPI.saveSelectedMidiInput(selectedMidiInputId);
    }
    if (selectedMidiInputId && midiInitialized) {
        initializeApc40(selectedMidiInputId);
    }
  }, [selectedMidiInputId, midiInitialized, midiInputs]);

  const sendFeedback = useCallback((controlId, value, overrideChannel = null) => {
    if (!selectedMidiInputId || !midiInitialized) return;
    const mapping = mappings[controlId];
    if (mapping && mapping.type === 'note') {
        // APC40 LEDs respond to Note On with velocity for color/state.
        // If value is a number, use it directly (0-127).
        // If boolean, map true->127 (On), false->0 (Off).
        let velocity = 0;
        if (typeof value === 'number') {
            velocity = value;
        } else {
            velocity = value ? 127 : 0;
        }
        
        const channel = overrideChannel !== null ? overrideChannel : mapping.channel;
        sendNote(selectedMidiInputId, mapping.address, velocity, channel);
    }
  }, [selectedMidiInputId, midiInitialized, mappings]);

  // Listen to MIDI events
  useEffect(() => {
    let cleanup = () => {};
    if (selectedMidiInputId) {
      cleanup = listenToMidiInput(selectedMidiInputId, (event) => {
        if (isMappingRef.current) {
            setLastMidiEvent(event);
        }
        handleIncomingMidi(event);
      });
    }
    return cleanup;
  }, [selectedMidiInputId, isMapping, learningId, mappings]); // Re-bind listener if key state changes

  // Keep a ref of isMapping for the listener
  const isMappingRef = useRef(isMapping);
  useEffect(() => {
      isMappingRef.current = isMapping;
  }, [isMapping]);

  const handleIncomingMidi = (event) => {
    // Check for Shift Key (APC40: CH1 Note D7)
    const isApcShiftKey = event.channel === 1 && event.note === 'D7';
    if (isApcShiftKey) {
        const active = (event.type === 'noteon');
        setIsShiftDown(active);
        isShiftDownRef.current = active;
        console.log(`Shift ${active ? 'Down' : 'Up'}`);
        return;
    }

    // 1. If in "Learn Mode" for a specific ID
    if (isMapping && learningId) {
      // Don't map the release (noteoff)
      if (event.type === 'noteoff') return;

      // Assign this event to the learningId
      const addressLabel = event.note || event.controller;
      const requiresShift = isShiftDownRef.current;
      const newMapping = {
        type: (event.type === 'noteon' || event.type === 'noteoff') ? 'note' : 'cc',
        channel: event.channel, 
        address: addressLabel,
        requiresShift: requiresShift,
        label: `${requiresShift ? '⇧' : ''}CH${event.channel}:${addressLabel}`
      };
      
      console.log(`Mapped ${learningId} to:`, newMapping);
      setMappings(prev => ({
        ...prev,
        [learningId]: newMapping
      }));
      setLearningId(null); // Stop learning for this ID
      return;
    }

    // 2. Normal Operation: Check if this event maps to any control
    Object.entries(mappings).forEach(([controlId, mapping]) => {
      const isNoteMatch = (event.type === 'noteon' || event.type === 'noteoff') && 
                          mapping.type === 'note' && 
                          event.note === mapping.address && 
                          event.channel === mapping.channel;
      
      const isCcMatch = event.type === 'controlchange' && 
                        mapping.type === 'cc' && 
                        event.controller === mapping.address && 
                        event.channel === mapping.channel;
      
      // Match shift state only for notes (CC usually ignore shift)
      const shiftMatch = mapping.type === 'cc' || (!!mapping.requiresShift === isShiftDownRef.current);

      if ((isNoteMatch || isCcMatch) && shiftMatch) {
        if (onMidiCommandRef.current) {
          // Explicitly handle 0 values for CC and NoteOff
          let val;
          if (event.type === 'controlchange') {
              val = event.value ?? 0;
          } else if (event.type === 'noteoff') {
              val = 0;
          } else {
              val = event.velocity ?? 0;
          }
          onMidiCommandRef.current(controlId, val, 127, event.type);
        }
      }
    });
  };

  const startMapping = () => setIsMapping(true);
  const stopMapping = () => {
      setIsMapping(false);
      setLearningId(null);
  }

  const removeMapping = (controlId) => {
      setMappings(prev => {
          const next = { ...prev };
          delete next[controlId];
          return next;
      });
  };

  const value = {
    midiInitialized,
    midiInputs,
    selectedMidiInputId,
    setSelectedMidiInputId,
    isMapping,
    startMapping,
    stopMapping,
    learningId,
    setLearningId,
    mappings,
    setMappings,
    removeMapping, // Add removeMapping
    saveMappings,
    exportMappings,
    importMappings,
    initializeApc40,
    sendFeedback,
    lastMidiEvent,
    isShiftDown
  };

  return (
    <MidiContext.Provider value={value}>
      {children}
    </MidiContext.Provider>
  );
};
