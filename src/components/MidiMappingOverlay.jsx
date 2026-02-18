import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';

const MidiMappingOverlay = () => {
  const { 
    isMapping: isMidiMapping, 
    mappings: midiMappings, 
    learningId: midiLearningId, 
    setLearningId: setMidiLearningId,
    removeAssignment,
    setMappings,
    midiInputs,
    selectedMidiInputId
  } = useMidi();
  const { isMapping: isArtnetMapping, mappings: artnetMappings, learningId: artnetLearningId } = useArtnet() || {};
  const { isMapping: isKeyboardMapping, mappings: keyboardMappings, learningId: keyboardLearningId } = useKeyboard() || {};

  const isMapping = isMidiMapping || isArtnetMapping || isKeyboardMapping;
  const [overlays, setOverlays] = useState([]);

  // Find assignments for the active learningId
  const currentAssignments = useMemo(() => {
      if (!midiLearningId) return [];
      const results = [];
      Object.entries(midiMappings).forEach(([key, assignments]) => {
          assignments.forEach(a => {
              if (a.controlId === midiLearningId) {
                  results.push({ key, ...a });
              }
          });
      });
      return results;
  }, [midiLearningId, midiMappings]);

  const updateAssignment = (key, controlId, field, value) => {
      setMappings(prev => {
          const next = { ...prev };
          if (!next[key]) return prev;
          next[key] = next[key].map(a => {
              if (a.controlId === controlId) return { ...a, [field]: value };
              return a;
          });
          return next;
      });
  };

  const updateOverlayPositions = useCallback(() => {
    if (!isMapping) return;

    const elements = document.querySelectorAll('[data-mappable-id]');
    const newOverlays = Array.from(elements).map(el => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-mappable-id'),
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        }
      };
    });
    setOverlays(newOverlays);
  }, [isMapping]);

  useEffect(() => {
    if (isMapping) {
      updateOverlayPositions();
      window.addEventListener('resize', updateOverlayPositions);
      // Small delay to ensure layout has settled
      const timer = setTimeout(updateOverlayPositions, 100);
      return () => {
        window.removeEventListener('resize', updateOverlayPositions);
        clearTimeout(timer);
      };
    } else {
      setOverlays([]);
    }
  }, [isMapping, updateOverlayPositions]);

  if (!isMapping) return null;

  return ReactDOM.createPortal(
    <div className="midi-mapping-global-overlay-container">
      {overlays.map(overlay => {
        let mappingLabel = null;
        const isMidi = isMidiMapping;
        const isArtnet = isArtnetMapping;
        const isKeyboard = isKeyboardMapping;

        if (isMidi) {
            // Find ALL hardware keys that have an assignment for this overlay.id
            const linkedHardware = Object.entries(midiMappings).filter(([key, assignments]) => 
                assignments.some(a => a.controlId === overlay.id)
            );
            if (linkedHardware.length > 0) {
                const first = linkedHardware[0][1].find(a => a.controlId === overlay.id);
                mappingLabel = first.label;
                if (linkedHardware.length > 1) mappingLabel += ` (+${linkedHardware.length - 1})`;
            }
        } else if (isArtnet) {
            const artnetMapping = artnetMappings ? artnetMappings[overlay.id] : null;
            mappingLabel = artnetMapping ? artnetMapping.label : null;
        } else if (isKeyboard) {
            const keyboardMapping = keyboardMappings ? keyboardMappings[overlay.id] : null;
            mappingLabel = keyboardMapping ? keyboardMapping.label : null;
        }
        
        const isLearning = (isMidi && midiLearningId === overlay.id) || 
                           (isArtnet && artnetLearningId === overlay.id) ||
                           (isKeyboard && keyboardLearningId === overlay.id);

        return (
          <React.Fragment key={overlay.id}>
            <div
                className={`midi-mapping-label-box ${isLearning ? 'learning' : ''} ${mappingLabel ? 'mapped' : ''} ${isArtnet ? 'artnet-mapping' : ''} ${isKeyboard ? 'keyboard-mapping' : ''}`}
                style={{
                position: 'fixed',
                top: overlay.rect.top,
                left: overlay.rect.left,
                width: overlay.rect.width,
                height: overlay.rect.height,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999
                }}
            >
                <div className="mapping-label">
                {mappingLabel ? mappingLabel : '+'}
                </div>
            </div>

            {isLearning && isMidi && (
                <div 
                    className="assignment-editor-popup"
                    style={{
                        position: 'fixed',
                        top: overlay.rect.top + overlay.rect.height + 10,
                        left: overlay.rect.left,
                        background: '#1a1a1a',
                        border: '1px solid #444',
                        borderRadius: '5px',
                        padding: '10px',
                        zIndex: 10001,
                        minWidth: '250px',
                        boxShadow: '0 5px 15px rgba(0,0,0,0.5)',
                        pointerEvents: 'auto'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>MIDI Assignments</h4>
                        <button onClick={() => setMidiLearningId(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>×</button>
                    </div>

                    {currentAssignments.length > 0 ? (
                        currentAssignments.map((a, i) => (
                            <div key={`${a.key}_${i}`} className="assignment-item" style={{ background: '#222', padding: '8px', borderRadius: '4px', marginBottom: '8px', borderLeft: '3px solid var(--theme-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>{a.label}</span>
                                    <button 
                                        onClick={() => removeAssignment(a.key, a.controlId)}
                                        style={{ background: 'none', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '12px' }}
                                    >Remove</button>
                                </div>

                                <div className="setting-group" style={{ marginBottom: '5px' }}>
                                    <label style={{ fontSize: '10px', color: '#888', display: 'block' }}>Target</label>
                                    <select 
                                        value={a.targetType || 'position'} 
                                        onChange={(e) => updateAssignment(a.key, a.controlId, 'targetType', e.target.value)}
                                        style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #333', fontSize: '10px' }}
                                    >
                                        <option value="position">By Position (Static)</option>
                                        <option value="thisClip">This Clip (Contextual)</option>
                                        <option value="selectedLayer">Selected Layer (Dynamic)</option>
                                    </select>
                                </div>

                                <div className="setting-group">
                                    <label style={{ fontSize: '10px', color: '#888', display: 'block' }}>Input Device</label>
                                    <select 
                                        value={a.inputDeviceId || 'any'} 
                                        onChange={(e) => updateAssignment(a.key, a.controlId, 'inputDeviceId', e.target.value)}
                                        style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #333', fontSize: '10px' }}
                                    >
                                        <option value="any">Any Device</option>
                                        {midiInputs.map(input => <option key={input.id} value={input.id}>{input.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div style={{ textAlign: 'center', padding: '10px', color: '#666', fontSize: '0.8rem' }}>
                            Press a button or move a fader on your MIDI controller to add an assignment.
                        </div>
                    )}
                    
                    {currentAssignments.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#555', marginTop: '5px', textAlign: 'center' }}>
                            Press another MIDI control to add more links.
                        </div>
                    )}
                </div>
            )}
          </React.Fragment>
        );
      })}
    </div>,
    document.body
  );
};

export default MidiMappingOverlay;
