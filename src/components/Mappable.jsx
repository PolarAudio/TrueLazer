import React from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';

const Mappable = ({ id, children }) => {
  const { isMapping: isMidiMapping, setLearningId: setMidiLearningId, removeMapping } = useMidi();
  const { isMapping: isArtnetMapping, setLearningId: setArtnetLearningId } = useArtnet() || {};

  const isMapping = isMidiMapping || isArtnetMapping;

  const handleClickCapture = (e) => {
    if (isMapping) {
      e.preventDefault();
      e.stopPropagation();
      if (isMidiMapping) setMidiLearningId(id);
      if (isArtnetMapping) setArtnetLearningId(id);
    }
  };

  const handleContextMenu = (e) => {
      if (isMapping && isMidiMapping) {
          e.preventDefault();
          e.stopPropagation();
          removeMapping(id);
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