import React from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';

const Mappable = ({ id, children, style }) => {
  const { isMapping: isMidiMapping, setLearningId: setMidiLearningId, removeMapping: removeMidiMapping, setMappings } = useMidi();
  const { isMapping: isArtnetMapping, setLearningId: setArtnetLearningId, removeMapping: removeArtnetMapping } = useArtnet() || {};
  const { isMapping: isKeyboardMapping, setLearningId: setKeyboardLearningId, removeMapping: removeKeyboardMapping } = useKeyboard() || {};

  const isMapping = isMidiMapping || isArtnetMapping || isKeyboardMapping;

  const handleClickCapture = (e, dropdownValue = null) => {
    if (isMapping) {
      e.preventDefault();
      e.stopPropagation();
      const finalId = dropdownValue !== null ? `${id}_item_${dropdownValue}` : id;
      if (isMidiMapping) setMidiLearningId(finalId);
      if (isArtnetMapping) setArtnetLearningId(finalId);
      if (isKeyboardMapping) setKeyboardLearningId(finalId);
    }
  };

  const handleContextMenu = (e) => {
      if (isMapping) {
          e.preventDefault();
          e.stopPropagation();
          if (isMidiMapping) removeMidiMapping(id);
          if (isArtnetMapping) removeArtnetMapping(id);
          if (isKeyboardMapping) removeKeyboardMapping(id);
      }
  };

  // Ensure children is a single element
  const child = React.Children.only(children);

  // Special handling for Select elements to allow mapping individual options
  if (child.type === 'select' && isMapping) {
      return React.cloneElement(child, {
          'data-mappable-id': id,
          onClickCapture: handleClickCapture,
          onContextMenu: handleContextMenu,
          className: `${child.props.className || ''} mappable-target`.trim(),
          children: React.Children.map(child.props.children, (opt) => {
              if (opt.type === 'option') {
                  const optId = `${id}_item_${opt.props.value || opt.props.children}`;
                  return (
                      <option 
                        {...opt.props} 
                        data-mappable-id={optId}
                        style={{ ...opt.props.style, color: 'var(--theme-color)' }}
                      >
                        {opt.props.children} [Mappable]
                      </option>
                  );
              }
              return opt;
          })
      });
  }

  return React.cloneElement(child, {
    'data-mappable-id': id,
    onClickCapture: isMapping ? handleClickCapture : child.props.onClickCapture,
    onContextMenu: isMapping ? handleContextMenu : child.props.onContextMenu,
    className: `${child.props.className || ''} ${isMapping ? 'mappable-target' : ''}`.trim(),
    style: { ...child.props.style, ...style }
  });
};

export default Mappable;