import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';

const MidiMappingOverlay = () => {
  const { isMapping: isMidiMapping, mappings: midiMappings, learningId: midiLearningId } = useMidi();
  const { isMapping: isArtnetMapping, mappings: artnetMappings, learningId: artnetLearningId } = useArtnet() || {};
  const { isMapping: isKeyboardMapping, mappings: keyboardMappings, learningId: keyboardLearningId } = useKeyboard() || {};

  const isMapping = isMidiMapping || isArtnetMapping || isKeyboardMapping;
  const [overlays, setOverlays] = useState([]);

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
          <div
            key={overlay.id}
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
        );
      })}
    </div>,
    document.body
  );
};

export default MidiMappingOverlay;
