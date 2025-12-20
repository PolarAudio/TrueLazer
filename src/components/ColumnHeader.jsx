import React from 'react';
import Mappable from './Mappable';

const ColumnHeader = ({ name, index, onTrigger, onShowColumnHeaderContextMenu }) => {
  const handleContextMenu = (e) => {
    e.preventDefault();
    if (onShowColumnHeaderContextMenu) {
      onShowColumnHeaderContextMenu(index);
    }
  };

  const handleClick = (e) => {
    // Only trigger if it's a left click
    if (e.button === 0 && onTrigger) {
      onTrigger();
    }
  };

  return (
    <Mappable id={`column_${index}`}>
        <div 
        className="column-header trigger-button" 
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ cursor: 'pointer' }}
        >
        {name}
        </div>
    </Mappable>
  );
};

export default ColumnHeader;