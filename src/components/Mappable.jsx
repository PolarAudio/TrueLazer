import React from 'react';
import { useMidi } from '../contexts/MidiContext';

const Mappable = ({ id, children }) => {
  const { isMapping, setLearningId } = useMidi();

  const handleClickCapture = (e) => {
    if (isMapping) {
      e.preventDefault();
      e.stopPropagation();
      setLearningId(id); // Set this element as the one waiting for MIDI input
    }
  };

  // Ensure children is a single element
  const child = React.Children.only(children);

  return React.cloneElement(child, {
    'data-mappable-id': id,
    onClickCapture: isMapping ? handleClickCapture : child.props.onClickCapture,
    // Add a specific class if mapping is active for cursor feedback
    className: `${child.props.className || ''} ${isMapping ? 'mappable-target' : ''}`.trim()
  });
};

export default Mappable;