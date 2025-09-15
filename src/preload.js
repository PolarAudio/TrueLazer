const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'electronAPI', {
    onMenuAction: (callback) => {
      ipcRenderer.on('menu-action', (event, action) => callback(action));
      return () => ipcRenderer.removeListener('menu-action', callback);
    },
    showLayerContextMenu: (index) => ipcRenderer.send('show-layer-context-menu', index),
    showLayerFullContextMenu: (index) => ipcRenderer.send('show-layer-full-context-menu', index),
    showColumnContextMenu: (index) => ipcRenderer.send('show-column-context-menu', index),
    showClipContextMenu: (layerIndex, colIndex) => ipcRenderer.send('show-clip-context-menu', layerIndex, colIndex),
    showColumnHeaderClipContextMenu: (colIndex) => ipcRenderer.send('show-column-header-clip-context-menu', colIndex),
    sendContextMenuAction: (action) => ipcRenderer.send('context-menu-action', action),
    onContextMenuActionFromMain: (callback) => {
      ipcRenderer.on('context-menu-action-from-main', (event, action) => callback(action));
      return () => ipcRenderer.removeListener('context-menu-action-from-main', callback);
    },
    onClipContextMenuCommand: (callback) => {
      const listener = (event, ...args) => callback(...args);
      ipcRenderer.on('clip-context-command', listener);
      return () => ipcRenderer.removeListener('clip-context-command', listener);
    },
    onColumnHeaderClipContextMenuCommand: (callback) => {
      const listener = (event, command) => callback(command);
      ipcRenderer.on('column-header-clip-context-command', listener);
      return () => ipcRenderer.removeListener('column-header-clip-context-command', listener);
    },
    onLayerFullContextMenuCommand: (callback) => {
      const listener = (event, command, layerIndex) => callback(command, layerIndex);
      ipcRenderer.on('layer-full-context-command', listener);
      return () => ipcRenderer.removeListener('layer-full-context-command', listener);
    },
    onRenderSettingsCommand: (callback) => {
      const listener = (event, command) => callback(command);
      ipcRenderer.on('render-settings-command', listener);
      return () => ipcRenderer.removeListener('render-settings-command', listener);
    },
    openFileExplorer: () => ipcRenderer.invoke('open-file-explorer'),
    readIldFiles: (directoryPath) => ipcRenderer.invoke('read-ild-files', directoryPath),
    readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),
    toggleShortcutsWindow: () => ipcRenderer.send('toggle-shortcuts-window'),
    toggleOutputSettingsWindow: () => ipcRenderer.send('toggle-output-settings-window'),
  }
);
