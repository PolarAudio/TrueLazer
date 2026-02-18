import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { initializeMidi, getMidiInputs, listenToMidiInput, stopListeningToMidiInput, sendSysex, sendNote, listenToStateChange } from '../utils/midi';

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
        setMidiInputs(getMidiInputs());
        
        // Listen for connection changes (hotplugging)
        listenToStateChange(() => {
            console.log("MIDI Device change detected, refreshing inputs...");
            setMidiInputs(getMidiInputs());
        });

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

  // Reactive Auto-Selection for MIDI Inputs
  useEffect(() => {
      const autoSelect = async () => {
          if (!midiInitialized || midiInputs.length === 0) return;
          
          let targetId = selectedMidiInputId;
          
          // 1. If none selected, try to load saved preference
          if (!targetId && window.electronAPI?.getSelectedMidiInput) {
              const savedId = await window.electronAPI.getSelectedMidiInput();
              if (savedId && midiInputs.some(i => i.id === savedId)) {
                  targetId = savedId;
              }
          }
          
          // 2. If still none, or the current selected is missing from hardware, pick first available
          if (!targetId || !midiInputs.some(i => i.id === targetId)) {
              targetId = midiInputs[0].id;
          }
          
          if (targetId !== selectedMidiInputId) {
              console.log(`MIDI: Auto-selecting input: ${targetId}`);
              setSelectedMidiInputId(targetId);
          }
      };
      autoSelect();
  }, [midiInitialized, midiInputs, selectedMidiInputId]);

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
    if (!midiInitialized) return;

    // We need to find ALL hardware keys that are mapped to this controlId
    Object.entries(mappings).forEach(([key, assignments]) => {
        const assignment = assignments.find(a => a.controlId === controlId);
        if (assignment) {
            const [midiType, channelStr, address] = key.split(':');
            if (midiType === 'note') {
                const channel = overrideChannel !== null ? overrideChannel : parseInt(channelStr);
                const outputId = assignment.outputDeviceId || selectedMidiInputId;
                
                if (outputId && outputId !== 'any') {
                    let velocity = 0;
                    if (typeof value === 'number') velocity = Math.round(value * 127);
                    else velocity = value ? 127 : 0;
                    
                    sendNote(outputId, address, velocity, channel);
                }
            }
        }
    });
  }, [selectedMidiInputId, midiInitialized, mappings]);

  // Listen to MIDI events
  useEffect(() => {
    let cleanup = () => {};
    if (selectedMidiInputId) {
      console.log(`(Re)binding MIDI listener for: ${selectedMidiInputId}`);
      cleanup = listenToMidiInput(selectedMidiInputId, (event) => {
        if (isMappingRef.current) {
            setLastMidiEvent(event);
        }
        handleIncomingMidi(event);
      });
    }
    return cleanup;
  }, [selectedMidiInputId, isMapping, learningId, mappings, midiInputs]); // Added midiInputs to ensure re-binding on hotplug

  const isMappingRef = useRef(isMapping);
  useEffect(() => {
      isMappingRef.current = isMapping;
  }, [isMapping]);

  const getMappingKey = (type, channel, address) => {
      const midiType = (type === 'noteon' || type === 'noteoff') ? 'note' : 'cc';
      return `${midiType}:${channel}:${address}`;
  };

  const handleIncomingMidi = (event) => {
    // Check for Shift Key (APC40: CH1 Note D7)
    const isApcShiftKey = event.channel === 1 && event.note === 'D7';
    if (isApcShiftKey) {
        const active = (event.type === 'noteon');
        setIsShiftDown(active);
        isShiftDownRef.current = active;
        return;
    }

    // 1. If in "Learn Mode" for a specific ID
    if (isMapping && learningId) {
      if (event.type === 'noteoff') return;

      const addressLabel = event.note || event.controller;
      const requiresShift = isShiftDownRef.current;
      const key = getMappingKey(event.type, event.channel, addressLabel);
      
      const newAssignment = {
        controlId: learningId,
        requiresShift: requiresShift,
        targetType: 'position', // Default: 'position', 'selectedLayer', 'thisClip'
        inputDeviceId: selectedMidiInputId,
        outputDeviceId: selectedMidiInputId,
        label: `${requiresShift ? '⇧' : ''}CH${event.channel}:${addressLabel}`
      };
      
      setMappings(prev => {
          const currentForKey = prev[key] || [];
          // Avoid duplicate assignments for the SAME controlId on the SAME key
          if (currentForKey.some(a => a.controlId === learningId)) return prev;
          return {
              ...prev,
              [key]: [...currentForKey, newAssignment]
          };
      });
      setLearningId(null);
      return;
    }

    // 2. Normal Operation: Iterate through all assignments for this hardware key
    const key = getMappingKey(event.type, event.channel, event.note || event.controller);
    const assignments = mappings[key];

    if (assignments && assignments.length > 0) {
        assignments.forEach(assignment => {
            // Match shift state only for notes
            const isNote = key.startsWith('note:');
            const shiftMatch = !isNote || (!!assignment.requiresShift === isShiftDownRef.current);
            
            // Device filtering (if specified)
            const deviceMatch = !assignment.inputDeviceId || assignment.inputDeviceId === 'any' || assignment.inputDeviceId === selectedMidiInputId;

            if (shiftMatch && deviceMatch) {
                if (onMidiCommandRef.current) {
                    let val;
                    if (event.type === 'controlchange') {
                        val = event.value ?? 0;
                    } else if (event.type === 'noteoff') {
                        val = 0;
                    } else {
                        val = event.velocity ?? 0;
                    }
                    onMidiCommandRef.current(assignment.controlId, val, 127, event.type, assignment);
                }
            }
        });
    }
  };

  const startMapping = () => setIsMapping(true);
  const stopMapping = () => {
      setIsMapping(false);
      setLearningId(null);
  }

  const removeMapping = (controlId) => {
      setMappings(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(key => {
              next[key] = next[key].filter(a => a.controlId !== controlId);
              if (next[key].length === 0) delete next[key];
          });
          return next;
      });
  };

  const removeAssignment = (key, controlId) => {
      setMappings(prev => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          next[key] = next[key].filter(a => a.controlId !== controlId);
          if (next[key].length === 0) delete next[key];
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
    removeMapping,
    removeAssignment,
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
