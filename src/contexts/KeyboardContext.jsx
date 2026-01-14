import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const KeyboardContext = createContext(null);

export const useKeyboard = () => {
  return useContext(KeyboardContext);
};

export const KeyboardProvider = ({ children, onCommand, enabled = false }) => {
  const [isMapping, setIsMapping] = useState(false);
  const [learningId, setLearningId] = useState(null);
  const [mappings, setMappings] = useState({}); // { controlId: { key: 'Space', label: 'SPACE' } }
  
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  // Load saved mappings
  useEffect(() => {
    const load = async () => {
      if (window.electronAPI && window.electronAPI.getKeyboardMappings) {
        const saved = await window.electronAPI.getKeyboardMappings();
        if (saved) setMappings(saved);
      }
    };
    load();
  }, []);

  const saveMappings = async () => {
    if (window.electronAPI && window.electronAPI.saveKeyboardMappings) {
      await window.electronAPI.saveKeyboardMappings(mappings);
    }
  };

  const exportMappings = async () => {
    if (window.electronAPI && window.electronAPI.exportMappings) {
        await window.electronAPI.exportMappings(mappings, 'keyboard');
    }
  };

  const importMappings = async () => {
    if (window.electronAPI && window.electronAPI.importMappings) {
        const result = await window.electronAPI.importMappings('keyboard');
        if (result.success && result.mappings) {
            setMappings(result.mappings);
        }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!enabled) return;

      // Prevent shortcuts if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      if (isMapping && learningId) {
        e.preventDefault();
        const newMapping = {
          key: e.code,
          label: e.code.replace('Key', '').replace('Digit', '')
        };
        setMappings(prev => ({ ...prev, [learningId]: newMapping }));
        setLearningId(null);
        return;
      }

      // Normal trigger
      Object.entries(mappings).forEach(([controlId, mapping]) => {
        if (e.code === mapping.key) {
          e.preventDefault();
          if (onCommandRef.current) {
            onCommandRef.current(controlId, 1, 1, 'keydown');
          }
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, isMapping, learningId, mappings]);

  const value = {
    isMapping,
    startMapping: () => setIsMapping(true),
    stopMapping: () => { setIsMapping(false); setLearningId(null); },
    learningId,
    setLearningId,
    mappings,
    setMappings,
    saveMappings,
    exportMappings,
    importMappings,
    removeMapping: (id) => setMappings(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
    })
  };

  return (
    <KeyboardContext.Provider value={value}>
      {children}
    </KeyboardContext.Provider>
  );
};
