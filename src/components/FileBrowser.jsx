import React, { useState } from 'react';

const FileBrowser = () => {
  const [selectedDirectory, setSelectedDirectory] = useState('');
  const [ildFiles, setIldFiles] = useState([]);

  const handleOpenExplorer = async () => {
    if (window.electronAPI) {
      const directoryPath = await window.electronAPI.openFileExplorer();
      if (directoryPath) {
        setSelectedDirectory(directoryPath);
        const files = await window.electronAPI.readIldFiles(directoryPath);
        setIldFiles(files);
      }
    }
  };

  return (
    <div className="file-browser">
      <h3>ILD File Browser</h3>
      <button onClick={handleOpenExplorer}>Open Folder</button>
      {selectedDirectory && <p>Selected Directory: {selectedDirectory}</p>}
      <div className="ild-file-list">
        {ildFiles.length > 0 ? (
          ildFiles.map((filePath, index) => {
            const fileName = filePath.split('\\').pop();
            return (
              <div
                key={index}
                className="ild-file-item"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify({ filePath, fileName }))}
              >
                {fileName}
              </div>
            );
          })
        ) : (
          <p>No ILD files found in selected directory.</p>
        )}
      </div>
    </div>
  );
};

export default FileBrowser;
