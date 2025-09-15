import React from 'react';

const ColumnHeader = ({ name, index, onShowColumnHeaderContextMenu }) => {
  const handleContextMenu = (e) => {
    e.preventDefault();
    console.log(`Right-clicked ColumnHeader at index: ${index}`);
    if (onShowColumnHeaderContextMenu) {
      onShowColumnHeaderContextMenu(index);
    }
  };

  return (
    <div className="column-header" onContextMenu={handleContextMenu}>{name}</div>
  );
};

export default ColumnHeader;