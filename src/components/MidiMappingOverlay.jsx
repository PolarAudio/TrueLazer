import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';

const MidiMappingOverlay = () => {
  const { isMapping: isMidiMapping, mappings: midiMappings, learningId: midiLearningId } = useMidi();
  const { isMapping: isArtnetMapping, mappings: artnetMappings, learningId: artnetLearningId } = useArtnet() || {};

  const isMapping = isMidiMapping || isArtnetMapping;
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
        const midiMapping = midiMappings[overlay.id];
        const artnetMapping = artnetMappings ? artnetMappings[overlay.id] : null;
        
        const isLearning = (isMidiMapping && midiLearningId === overlay.id) || 
                           (isArtnetMapping && artnetLearningId === overlay.id);

        // Show MIDI labels if MIDI mapping mode is active, otherwise show Art-Net labels if Art-Net mapping mode is active
        let mappingLabel = null;
        if (isMidiMapping) {
            mappingLabel = midiMapping ? midiMapping.label : null;
        } else if (isArtnetMapping) {
            mappingLabel = artnetMapping ? artnetMapping.label : null;
        }

        return (
          <div
            key={overlay.id}
            className={`midi-mapping-label-box ${isLearning ? 'learning' : ''} ${mappingLabel ? 'mapped' : ''} ${isArtnetMapping ? 'artnet-mapping' : ''}`}
            style={{
              position: 'fixed',
              top: overlay.rect.top,
              left: overlay.rect.left,
              width: overlay.rect.width,
              height: overlay.rect.height,
              pointerEvents: 'none', // Let clicks pass through to the Mappable's capture handler
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
