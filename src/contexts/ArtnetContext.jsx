import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const ArtnetContext = createContext(null);

export const useArtnet = () => {
  return useContext(ArtnetContext);
};

export const ArtnetProvider = ({ children, onArtnetCommand }) => {
  const [artnetInitialized, setArtnetInitialized] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [learningId, setLearningId] = useState(null);
  const [mappings, setMappings] = useState({}); // { controlId: { universe, channel, label } }
  const [lastDmxEvent, setLastDmxEvent] = useState(null);

  const onArtnetCommandRef = useRef(onArtnetCommand);
  useEffect(() => {
    onArtnetCommandRef.current = onArtnetCommand;
  }, [onArtnetCommand]);

  // Initialize Art-Net and Load Mappings
  useEffect(() => {
    const init = async () => {
      try {
        if (window.electronAPI && window.electronAPI.initializeArtnet) {
            const result = await window.electronAPI.initializeArtnet();
            if (result.success) {
                setArtnetInitialized(true);
                console.log("Art-Net initialized for mapping");
            }
        }

        // Load saved mappings from store
        if (window.electronAPI && window.electronAPI.getArtnetMappings) {
            const savedMappings = await window.electronAPI.getArtnetMappings();
            if (savedMappings) {
                console.log("Loaded saved Art-Net mappings:", savedMappings);
                setMappings(savedMappings);
            }
        }
      } catch (err) {
        console.error("Art-Net Init Failed:", err);
      }
    };
    init();
  }, []);

  const saveMappings = async () => {
      if (window.electronAPI && window.electronAPI.saveArtnetMappings) {
          await window.electronAPI.saveArtnetMappings(mappings);
          console.log("Art-Net mappings saved.");
      }
  };

  const exportMappings = async () => {
      if (window.electronAPI && window.electronAPI.exportMappings) {
          await window.electronAPI.exportMappings(mappings, 'artnet');
      }
  };

  const importMappings = async () => {
      if (window.electronAPI && window.electronAPI.importMappings) {
          const result = await window.electronAPI.importMappings('artnet');
          if (result.success && result.mappings) {
              setMappings(result.mappings);
              console.log("Art-Net mappings imported.");
          }
      }
  };

  // Listen to Art-Net events from main process
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onArtnetDataReceived) {
        const cleanup = window.electronAPI.onArtnetDataReceived((data) => {
            // data: { universe, channel, value }
            // Only update state (triggering re-render) if we are in mapping mode
            // or if we want to show the last signal in the UI.
            if (isMappingRef.current) {
                setLastDmxEvent(data);
            }
            handleIncomingArtnet(data);
        });
        return cleanup;
    }
  }, [isMapping, learningId, mappings]);

  // Keep a ref of isMapping for the listener
  const isMappingRef = useRef(isMapping);
  useEffect(() => {
      isMappingRef.current = isMapping;
  }, [isMapping]);

  const handleIncomingArtnet = (data) => {
    const { universe, channel, value } = data;

    // 1. If in "Learn Mode" for a specific ID
    if (isMapping && learningId) {
      if (value === 0) return;
      const newMapping = { universe, channel, label: `U${universe}:CH${channel + 1}` };
      setMappings(prev => ({ ...prev, [learningId]: newMapping }));
      setLearningId(null);
      return;
    }

    // 2. Fixed Footprint Logic (Hybrid)
    if (universe === 0) {
        if (channel < 10) {
            // Master Section (CH 1-10)
            if (channel === 0) onArtnetCommandRef.current('master_intensity', value);
            else if (channel === 1) onArtnetCommandRef.current(value >= 128 ? 'blackout_on' : 'blackout_off', value);
            else if (channel === 2) {
                const pageIdx = Math.min(7, Math.floor(value / 32));
                onArtnetCommandRef.current(`middle_bar_page_${pageIdx}`, value);
            }
            else if (channel === 3) {
                if (value >= 1 && value <= 85) onArtnetCommandRef.current('transport_play', value);
                else if (value >= 86 && value <= 170) onArtnetCommandRef.current('transport_pause', value);
                else if (value >= 171 && value <= 255) onArtnetCommandRef.current('transport_stop', value);
            }
            return;
        } else if (channel >= 10 && channel < 110) {
            // Layer Footprints (20 channels per layer, starting at CH 11)
            const layerIdx = Math.floor((channel - 10) / 20);
            const offset = (channel - 10) % 20;
            
            if (offset === 0) onArtnetCommandRef.current(`layer_${layerIdx}_intensity`, value);
            else if (offset === 1) {
                if (value >= 1 && value <= 64) onArtnetCommandRef.current(`layer_${layerIdx}_blackout_toggle`, value);
                else if (value >= 65 && value <= 128) onArtnetCommandRef.current(`layer_${layerIdx}_solo_toggle`, value);
                else if (value >= 129 && value <= 192) onArtnetCommandRef.current(`layer_${layerIdx}_autopilot_forward`, value);
                else if (value >= 193) onArtnetCommandRef.current(`layer_${layerIdx}_autopilot_off`, value);
            }
            else if (offset === 2) {
                // Range-based clip trigger: 0-10 Off, 11-20 Clip 1, 21-30 Clip 2...
                if (value > 10) {
                    const colIdx = Math.min(7, Math.floor((value - 11) / 10));
                    onArtnetCommandRef.current(`clip_${layerIdx}_${colIdx}`, value);
                } else {
                    onArtnetCommandRef.current(`layer_${layerIdx}_clear`, value);
                }
            }
            else if (offset === 3) onArtnetCommandRef.current(`layer_${layerIdx}_speed`, value);
            
            // Channels 5-20 are reserved/free for custom mapping
            return;
        }
    }

    // 3. Normal Operation: Custom Mappings
    Object.entries(mappings).forEach(([controlId, mapping]) => {
      if (mapping.universe === universe && mapping.channel === channel) {
        if (onArtnetCommandRef.current) {
          onArtnetCommandRef.current(controlId, value);
        }
      }
    });
  };

  const startMapping = () => setIsMapping(true);
  const stopMapping = () => {
      setIsMapping(false);
      setLearningId(null);
  }

  const value = {
    artnetInitialized,
    isMapping,
    startMapping,
    stopMapping,
    learningId,
    setLearningId,
    mappings,
    setMappings,
    saveMappings,
    exportMappings,
    importMappings,
    lastDmxEvent
  };

  return (
    <ArtnetContext.Provider value={value}>
      {children}
    </ArtnetContext.Provider>
  );
};
