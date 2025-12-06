const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'electronAPI', {
    send: (channel, data, networkInterface) => {
      if (channel === 'discover-dacs') {
        ipcRenderer.send(channel, data, networkInterface);
      } else {
        ipcRenderer.send(channel, data);
      }
    },
    on: (channel, callback) => {
      const listener = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    onMenuAction: (callback) => {
      ipcRenderer.on('menu-action', (event, action) => callback(action));
      return () => ipcRenderer.removeListener('menu-action', callback);
    },
    getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),
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
	    readFileAsBinary: (filePath) => ipcRenderer.invoke('read-file-as-binary', filePath),
	    toggleShortcutsWindow: () => ipcRenderer.send('toggle-shortcuts-window'),
	    toggleOutputSettingsWindow: () => ipcRenderer.send('toggle-output-settings-window'),
	        stopDacDiscovery: () => ipcRenderer.send('stop-dac-discovery'),
	            sendPlayCommand: (ip) => ipcRenderer.send('send-play-command', ip),
	            // New IPC functions for thumbnail mode synchronization
	            onUpdateThumbnailRenderMode: (callback) => { // Listener for main process to renderer
	              ipcRenderer.on('update-thumbnail-render-mode', (event, mode) => callback(mode));
	              return () => ipcRenderer.removeListener('update-thumbnail-render-mode', callback);
	            },
	            sendRendererThumbnailModeChanged: (mode) => ipcRenderer.send('renderer-thumbnail-mode-changed', mode), // Renderer to main for mode changes
	            onRequestRendererThumbnailMode: (callback) => { // Listener for main process requesting mode from renderer
	              ipcRenderer.on('request-renderer-thumbnail-mode', callback);
	              return () => ipcRenderer.removeListener('request-renderer-thumbnail-mode', callback);
	            },
	            // Settings
	            getAllSettings: () => ipcRenderer.invoke('get-all-settings'),
	            setRenderSettings: (settings) => ipcRenderer.invoke('set-render-settings', settings),
	            setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
	            setThumbnailRenderMode: (mode) => ipcRenderer.invoke('set-thumbnail-render-mode', mode),
	            setSelectedDac: (dac) => ipcRenderer.invoke('set-selected-dac', dac),
	            getDefaultProjectPath: () => ipcRenderer.invoke('get-default-project-path'),
              readFileForWorker: (filePath) => ipcRenderer.invoke('read-file-for-worker', filePath),
	          }
	        );
