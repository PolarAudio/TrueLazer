import React from 'react';

const ColumnHeader = ({ name, index }) => {
  const handleContextMenu = (e) => {
    e.preventDefault();
    console.log(`Right-clicked ColumnHeader at index: ${index}`);
    if (window.electronAPI) {
      window.electronAPI.sendContextMenuAction({ type: 'delete-column', index: index });
    }
  };

  return (
    <div className="column-header" onContextMenu={handleContextMenu}>{name}</div>
  );
};

export default ColumnHeader;