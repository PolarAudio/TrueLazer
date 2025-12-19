import React from 'react';

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
    <div 
      className="column-header trigger-button" 
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      style={{ cursor: 'pointer' }}
    >
      {name}
    </div>
  );
};

export default ColumnHeader;