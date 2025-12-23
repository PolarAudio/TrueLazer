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
      // For Art-Net, we usually map based on a value threshold or just any change
      // Only map if value > 0 to avoid mapping the "idle" state
      if (value === 0) return;

      const newMapping = {
        universe,
        channel,
        label: `U${universe}:CH${channel + 1}` // 1-indexed for display
      };
      
      console.log(`Mapped ${learningId} to Art-Net:`, newMapping);
      setMappings(prev => ({
        ...prev,
        [learningId]: newMapping
      }));
      setLearningId(null); // Stop learning for this ID
      return;
    }

    // 2. Normal Operation: Check if this event maps to any control
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
