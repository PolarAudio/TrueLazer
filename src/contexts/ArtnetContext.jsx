import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const ArtnetContext = createContext(null);

export const useArtnet = () => {
  return useContext(ArtnetContext);
};

export const processArtnetLogic = (data, mappings, onArtnetCommand, isMapping, learningId, setMappings, setLearningId) => {
    const { universe, channel, value } = data;

    // 1. If in "Learn Mode" for a specific ID
    if (isMapping && learningId) {
      if (value === 0) return true; // Handled
      const newMapping = { universe, channel, label: `U${universe}:CH${channel + 1}` };
      setMappings(prev => ({ ...prev, [learningId]: newMapping }));
      setLearningId(null);
      return true; // Handled
    }

    // 2. Fixed Footprint Logic (Hybrid)
    if (universe === 0) {
        if (channel < 10) {
            // Master Section (CH 1-10)
            if (channel === 0) onArtnetCommand('master_intensity', value);
            else if (channel === 1) onArtnetCommand(value >= 128 ? 'blackout_on' : 'blackout_off', value);
            else if (channel === 2) {
                const pageIdx = Math.min(7, Math.floor(value / 32));
                onArtnetCommand(`middle_bar_page_${pageIdx}`, value);
            }
            else if (channel === 3) {
                if (value >= 1 && value <= 85) onArtnetCommand('transport_play', value);
                else if (value >= 86 && value <= 170) onArtnetCommand('transport_pause', value);
                else if (value >= 171 && value <= 255) onArtnetCommand('transport_stop', value);
            }
            return true; // Handled
        } else if (channel >= 10 && channel < 110) {
            // Layer Footprints (20 channels per layer, starting at CH 11)
            const layerIdx = Math.floor((channel - 10) / 20);
            const offset = (channel - 10) % 20;
            
            if (offset === 0) onArtnetCommand(`layer_${layerIdx}_intensity`, value);
            else if (offset === 1) {
                if (value >= 1 && value <= 64) onArtnetCommand(`layer_${layerIdx}_blackout_toggle`, value);
                else if (value >= 65 && value <= 128) onArtnetCommand(`layer_${layerIdx}_solo_toggle`, value);
                else if (value >= 129 && value <= 192) onArtnetCommand(`layer_${layerIdx}_autopilot_forward`, value);
                else if (value >= 193) onArtnetCommand(`layer_${layerIdx}_autopilot_off`, value);
            }
            else if (offset === 2) {
                // Range-based clip trigger: 0-10 Off, 11-20 Clip 1, 21-30 Clip 2...
                if (value > 10) {
                    const colIdx = Math.min(7, Math.floor((value - 11) / 10));
                    onArtnetCommand(`clip_${layerIdx}_${colIdx}`, value);
                } else {
                    onArtnetCommand(`layer_${layerIdx}_clear`, value);
                }
            }
            else if (offset === 3) onArtnetCommand(`layer_${layerIdx}_speed`, value);
            
            return true; // Handled
        }
    }

    // 3. Normal Operation: Custom Mappings
    let customHandled = false;
    Object.entries(mappings).forEach(([controlId, mapping]) => {
      if (mapping.universe === universe && mapping.channel === channel) {
        if (onArtnetCommand) {
          onArtnetCommand(controlId, value);
          customHandled = true;
        }
      }
    });
    return customHandled;
};

export const ArtnetProvider = ({ children, onArtnetCommand }) => {
  const [artnetInitialized, setArtnetInitialized] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [learningId, setLearningId] = useState(null);
  const [mappings, setMappings] = useState({}); // { controlId: { universe, channel, label } }
  const [lastDmxEvent, setLastDmxEvent] = useState(null);
  const [dmxData, setDmxData] = useState({}); // { universe: Uint8Array(512) }
  const [universeFilter, setUniverseFilter] = useState(0);

  const onArtnetCommandRef = useRef(onArtnetCommand);
  useEffect(() => {
    onArtnetCommandRef.current = onArtnetCommand;
  }, [onArtnetCommand]);

  // ... exists ...

  // Listen to Art-Net events from main process
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onArtnetDataReceived) {
        const cleanup = window.electronAPI.onArtnetDataReceived((data) => {
            // data: { universe, channel, value }
            
            // 1. Update DMX Monitor Data
            setDmxData(prev => {
                const current = prev[data.universe] || new Uint8Array(512);
                if (current[data.channel] === data.value) return prev;
                const next = new Uint8Array(current);
                next[data.channel] = data.value;
                return { ...prev, [data.universe]: next };
            });

            // 2. Mapping Feedback
            if (isMappingRef.current) {
                setLastDmxEvent(data);
            }

            // 3. Process Logic
            handleIncomingArtnet(data);
        });
        return cleanup;
    }
  }, []); // Only run once on mount

  // ... exists ...

  const autoPatchFixedFootprint = () => {
      // The fixed footprint is actually hardcoded in processArtnetLogic, 
      // but we can add UI labels for them by creating "virtual" mappings 
      // or just letting the user know they are reserved.
      // However, for "Hybrid" mapping, we want to allow users to see them in the overlay.
      
      const newMappings = {};
      // Master (CH 1-10)
      newMappings['master_intensity'] = { universe: 0, channel: 0, label: 'U0:CH1 (Fixed)' };
      newMappings['blackout'] = { universe: 0, channel: 1, label: 'U0:CH2 (Fixed)' };
      newMappings['middle_bar_page'] = { universe: 0, channel: 2, label: 'U0:CH3 (Fixed)' };
      newMappings['transport'] = { universe: 0, channel: 3, label: 'U0:CH4 (Fixed)' };

      // Layers (CH 11-110)
      for (let i = 0; i < 5; i++) {
          const startCh = 10 + (i * 20);
          newMappings[`layer_${i}_intensity`] = { universe: 0, channel: startCh, label: `U0:CH${startCh + 1} (Fixed)` };
          newMappings[`layer_${i}_controls`] = { universe: 0, channel: startCh + 1, label: `U0:CH${startCh + 2} (Fixed)` };
          newMappings[`layer_${i}_trigger`] = { universe: 0, channel: startCh + 2, label: `U0:CH${startCh + 3} (Fixed)` };
          newMappings[`layer_${i}_speed`] = { universe: 0, channel: startCh + 3, label: `U0:CH${startCh + 4} (Fixed)` };
      }

      setMappings(prev => ({ ...prev, ...newMappings }));
      console.log("Auto-patched fixed DMX footprints.");
  };

  const removeMapping = (controlId) => {
      setMappings(prev => {
          const next = { ...prev };
          delete next[controlId];
          return next;
      });
  };

  const value = {
    artnetInitialized,
    isMapping,
    startMapping,
    stopMapping,
    learningId,
    setLearningId,
    mappings,
    setMappings,
    removeMapping,
    saveMappings,
    exportMappings,
    importMappings,
    lastDmxEvent,
    dmxData,
    universeFilter,
    setUniverseFilter,
    autoPatchFixedFootprint
  };

  return (
    <ArtnetContext.Provider value={value}>
      {children}
    </ArtnetContext.Provider>
  );
};
