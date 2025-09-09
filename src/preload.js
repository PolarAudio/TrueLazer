const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'electronAPI', {
    onMenuAction: (callback) => {
      ipcRenderer.on('menu-action', (event, action) => callback(action));
      return () => ipcRenderer.removeListener('menu-action', callback);
    },
    showLayerContextMenu: (index) => ipcRenderer.send('show-layer-context-menu', index),
    showColumnContextMenu: (index) => ipcRenderer.send('show-column-context-menu', index),
    sendContextMenuAction: (action) => ipcRenderer.send('context-menu-action', action),
    onContextMenuActionFromMain: (callback) => {
      ipcRenderer.on('context-menu-action-from-main', (event, action) => callback(action));
      return () => ipcRenderer.removeListener('context-menu-action-from-main', callback);
    },
    openFileExplorer: () => ipcRenderer.invoke('open-file-explorer'),
    readIldFiles: (directoryPath) => ipcRenderer.invoke('read-ild-files', directoryPath),
    toggleShortcutsWindow: () => ipcRenderer.send('toggle-shortcuts-window'),
    toggleOutputSettingsWindow: () => ipcRenderer.send('toggle-output-settings-window'),
  }
);
