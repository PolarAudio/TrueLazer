import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useMidi } from '../contexts/MidiContext';

const MidiMappingOverlay = () => {
  const { isMapping, mappings, learningId } = useMidi();
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
        const mapping = mappings[overlay.id];
        const isLearning = learningId === overlay.id;

        return (
          <div
            key={overlay.id}
            className={`midi-mapping-label-box ${isLearning ? 'learning' : ''} ${mapping ? 'mapped' : ''}`}
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
              {mapping ? mapping.label : '+'}
            </div>
          </div>
        );
      })}
    </div>,
    document.body
  );
};

export default MidiMappingOverlay;
