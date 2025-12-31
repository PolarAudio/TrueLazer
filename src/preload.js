import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld(
  'electronAPI', {
    discoverDacs: (timeout, networkInterfaceIp) => ipcRenderer.invoke('discover-dacs', timeout, networkInterfaceIp),
    getDacServices: (ip, localIp) => ipcRenderer.invoke('get-dac-services', ip, localIp),
    sendFrame: (ip, channel, frame, fps) => ipcRenderer.invoke('send-frame', ip, channel, frame, fps),
    getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, callback) => {
      const listener = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    onMenuAction: (callback) => {
      ipcRenderer.on('menu-action', (event, action) => callback(action));
      return () => ipcRenderer.removeListener('menu-action', callback);
    },
    showLayerContextMenu: (index) => ipcRenderer.send('show-layer-context-menu', index),
    showLayerFullContextMenu: (index) => ipcRenderer.send('show-layer-full-context-menu', index),
    showColumnContextMenu: (index) => ipcRenderer.send('show-column-context-menu', index),
    showClipContextMenu: (...args) => ipcRenderer.send('show-clip-context-menu', ...args),
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
                getMidiMappings: () => ipcRenderer.invoke('get-midi-mappings'),
                saveMidiMappings: (mappings) => ipcRenderer.invoke('save-midi-mappings', mappings),
	            	            getDefaultProjectPath: () => ipcRenderer.invoke('get-default-project-path'),
	                                        readFileForWorker: (filePath) => ipcRenderer.invoke('read-file-for-worker', filePath),
	                                        fetchUrlAsArrayBuffer: (url) => ipcRenderer.invoke('fetch-url-as-arraybuffer', url),
	                                        showAudioFileDialog: () => ipcRenderer.invoke('show-audio-file-dialog'),
	                                        showFontFileDialog: () => ipcRenderer.invoke('show-font-file-dialog'),
	                                        setAudioDevices: (devices) => ipcRenderer.send('set-audio-devices', devices),
	                                        onUpdateAudioDeviceId: (callback) => {
	                                          const subscription = (event, deviceId) => callback(deviceId);
	                                          ipcRenderer.on('update-audio-device-id', subscription);
	                                          return () => ipcRenderer.removeListener('update-audio-device-id', subscription);
	                                        },
                                            saveThumbnail: (arrayBuffer, filename) => ipcRenderer.invoke('save-thumbnail', arrayBuffer, filename),
                                            // ArtNet
                                            initializeArtnet: () => ipcRenderer.invoke('initialize-artnet'),
                                            getArtnetUniverses: () => ipcRenderer.invoke('get-artnet-universes'),
                                            sendArtnetData: (universe, channel, value) => ipcRenderer.send('send-artnet-data', universe, channel, value),
                                            closeArtnet: () => ipcRenderer.send('close-artnet'),
                                            listenArtnetUniverse: (universe) => ipcRenderer.send('artnet-listen-universe', universe),
                                            onArtnetDataReceived: (callback) => {
                                                const listener = (event, { universe, data }) => {
                                                    // data is array of 512.
                                                    data.forEach((val, idx) => {
                                                        if (val > 0) { // Simple filter for non-zero to detect signal
                                                            callback({ universe, channel: idx, value: val });
                                                        }
                                                    });
                                                };
                                                ipcRenderer.on('artnet-data-received', listener);
                                                return () => ipcRenderer.removeListener('artnet-data-received', listener);
                                            },
                                            getArtnetMappings: () => ipcRenderer.invoke('get-artnet-mappings'),
                                            saveArtnetMappings: (mappings) => ipcRenderer.invoke('save-artnet-mappings', mappings),
                                            exportMappings: (mappings, type) => ipcRenderer.invoke('export-mappings', mappings, type),
                                            importMappings: (type) => ipcRenderer.invoke('import-mappings', type),
                                            // OSC
                                            initializeOsc: (config) => ipcRenderer.invoke('initialize-osc', config),
                                            sendOscMessage: (address, args) => ipcRenderer.send('send-osc-message', address, args),
                                            closeOsc: () => ipcRenderer.send('close-osc'),
                                            onOscMessageReceived: (callback) => {
                                                const listener = (event, message) => callback(message);
                                                ipcRenderer.on('osc-message-received', listener);
                                                return () => ipcRenderer.removeListener('osc-message-received', listener);
                                            },
	                          	          }	        );
