import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';

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

  const saveMappings = useCallback(async () => {
    if (window.electronAPI && window.electronAPI.saveKeyboardMappings) {
      await window.electronAPI.saveKeyboardMappings(mappings);
    }
  }, [mappings]);

  const exportMappings = useCallback(async () => {
    if (window.electronAPI && window.electronAPI.exportMappings) {
        await window.electronAPI.exportMappings(mappings, 'keyboard');
    }
  }, [mappings]);

  const importMappings = useCallback(async () => {
    if (window.electronAPI && window.electronAPI.importMappings) {
        const result = await window.electronAPI.importMappings('keyboard');
        if (result.success && result.mappings) {
            setMappings(result.mappings);
        }
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!enabled) return;

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

      Object.entries(mappings).forEach(([controlId, mapping]) => {
        if (e.code === mapping.key) {
          e.preventDefault();
          if (onCommandRef.current) {
            onCommandRef.current(controlId, 1, 1, 'keydown');
          }
        }
      });
    };

    const handleKeyUp = (e) => {
      if (!enabled) return;

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      Object.entries(mappings).forEach(([controlId, mapping]) => {
        if (e.code === mapping.key) {
          e.preventDefault();
          if (onCommandRef.current) {
            onCommandRef.current(controlId, 0, 1, 'keyup');
          }
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled, isMapping, learningId, mappings]);

  const startMapping = useCallback(() => setIsMapping(true), []);
  const stopMapping = useCallback(() => { setIsMapping(false); setLearningId(null); }, []);
  const removeMapping = useCallback((id) => setMappings(prev => {
    const next = { ...prev };
    delete next[id];
    return next;
  }), []);

  const value = useMemo(() => ({
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
    removeMapping
  }), [isMapping, learningId, mappings, saveMappings, exportMappings, importMappings, startMapping, stopMapping, removeMapping, setMappings, setLearningId]);

  return (
    <KeyboardContext.Provider value={value}>
      {children}
    </KeyboardContext.Provider>
  );
};
