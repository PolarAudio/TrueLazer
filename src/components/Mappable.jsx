import React from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';

const Mappable = ({ id, children }) => {
  const { isMapping: isMidiMapping, setLearningId: setMidiLearningId, removeMapping: removeMidiMapping } = useMidi();
  const { isMapping: isArtnetMapping, setLearningId: setArtnetLearningId, removeMapping: removeArtnetMapping } = useArtnet() || {};
  const { isMapping: isKeyboardMapping, setLearningId: setKeyboardLearningId, removeMapping: removeKeyboardMapping } = useKeyboard() || {};

  const isMapping = isMidiMapping || isArtnetMapping || isKeyboardMapping;

  const handleClickCapture = (e) => {
    if (isMapping) {
      e.preventDefault();
      e.stopPropagation();
      if (isMidiMapping) setMidiLearningId(id);
      if (isArtnetMapping) setArtnetLearningId(id);
      if (isKeyboardMapping) setKeyboardLearningId(id);
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

  return React.cloneElement(child, {
    'data-mappable-id': id,
    onClickCapture: isMapping ? handleClickCapture : child.props.onClickCapture,
    onContextMenu: isMapping ? handleContextMenu : child.props.onContextMenu,
    // Add a specific class if mapping is active for cursor feedback
    className: `${child.props.className || ''} ${isMapping ? 'mappable-target' : ''}`.trim()
  });
};

export default Mappable;