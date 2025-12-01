const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { discoverDacs, sendFrame, getNetworkInterfaces, stopDiscovery, sendPlayCommand, stopSending } = require('./utils/dac-communication');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow; // Global variable to store the main window instance
let currentThumbnailRenderMode = 'still'; // Global variable to store the current thumbnail render mode

// This function needs to be globally accessible
function sendThumbnailModeToRenderer(mode) {
  if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-thumbnail-render-mode', mode);
  }
}

function buildApplicationMenu(mode) {
  const menuTemplate = [
    {
      label: 'TrueLazer',
      submenu: [
        { label: 'About', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'about'); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { app.quit(); } },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'General', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'settings-general'); } },
      ],
    },
    {
      label: 'Layer',
      submenu: [
        { label: 'Rename', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'layer-rename'); } },
        { label: 'Clear Clips', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'layer-clear-clips'); } },
      ],
    },
    {
      label: 'Column',
      submenu: [
		{ label: 'Duplicate', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'column-duplicate'); } },
        { label: 'Rename', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'column-rename'); } },
        { label: 'Clear Clips', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'column-clear-clips'); } },
      ],
    },
    {
      label: 'Clip',
      submenu: [
        { label: 'Trigger Style', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'clip-trigger-style'); } },
        { label: 'Thumbnail', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'clip-thumbnail'); } },
        { label: 'Cut', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'clip-cut'); } },
        { label: 'Copy', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'clip-copy'); } },
        { label: 'Paste', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'clip-paste'); } },
        { label: 'Rename', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'clip-rename'); } },
        { label: 'Clear', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'clip-clear'); } },
      ],
    },
    {
      label: 'Output',
      submenu: [
        { label: 'Open Output Settings', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'output-settings'); } },
      ],
    },
    {
      label: 'Shortcuts',
      submenu: [
        { label: 'Open Shortcuts Window', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'shortcuts-window'); } },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Predefined Layouts', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'view-layouts'); } },
                {
          label: 'Color Theme',
          submenu: [
            { label: 'Orange', type: 'radio', checked: true, click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-orange'); } },
            { label: 'Yellow', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-yellow'); } },
            { label: 'Cyan', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-cyan'); } },
            { label: 'Light Blue', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-light-blue'); } },
            { label: 'Blue', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-blue'); } },
            { label: 'Magenta', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-magenta'); } },
            { label: 'Red', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-red'); } },
          ]
        },
        {
          label: 'Render Mode',
          submenu: [
            // New thumbnail render mode options
            { label: 'Thumbnail Still Frame', type: 'radio', checked: mode === 'still', click: () => { sendThumbnailModeToRenderer('still'); } },
            { label: 'Thumbnail Live Render', type: 'radio', checked: mode === 'active', click: () => { sendThumbnailModeToRenderer('active'); } },
            { type: 'separator' },
            { label: 'Show Beam Effect', type: 'checkbox', checked: true, click: (menuItem) => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'showBeamEffect', value: menuItem.checked }); } },
            { type: 'separator' },
            {
              label: 'Effect Mode',
              submenu: [
                { label: 'Points', type: 'radio', checked: true, click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'points' }); } },
                { label: 'Lines', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'lines' }); } },
                { label: 'Points & Lines', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'both' }); } },
              ]
            },
            { type: 'separator' },
            {
              label: 'Preview Scan Rate',
              submenu: [
                { label: 'Fast', type: 'radio', checked: true, click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'previewScanRate', value: 1 }); } },
                { label: 'Madium', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'previewScanRate', value: 1.1 }); } },
                { label: 'Slow', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'previewScanRate', value: 1.3 }); } },
              ]
            },
            {
              label: 'Fade Alpha',
              submenu: [
                { label: '0.0', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 0.0 }); } },
                { label: '0.1', type: 'radio', checked: true, click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 0.1 }); } },
                { label: '0.2', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 0.2 }); } },
                { label: '0.5', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 0.5 }); } },
                { label: '1.0', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 1.0 }); } },
              ]
            },
            {
              label: 'Beam Alpha',
              submenu: [
                { label: '0.1', type: 'radio', checked: true, click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.1 }); } },
                { label: '0.2', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.2 }); } },
                { label: '0.5', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.5 }); } },
                { label: '1.0', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 1.0 }); } },
              ]
            },
          ]
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}


function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
    frame: true, // Set to false to remove the default window frame and title bar
  });

  if (isDev) {
    win.loadURL('http://localhost:5173'); // Vite development server default port
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '..\dist', 'index.html'));
  }

  // Assign to global mainWindow
  mainWindow = win;

  // Initial menu build
  buildApplicationMenu(currentThumbnailRenderMode);

  // IPC handlers for thumbnail render mode synchronization
  ipcMain.on('renderer-thumbnail-mode-changed', (event, mode) => {
      currentThumbnailRenderMode = mode;
      buildApplicationMenu(currentThumbnailRenderMode);
  });

  ipcMain.on('update-thumbnail-render-mode', (event, mode) => {
      // This is received from a menu click in the main process itself
      // We need to send it to the renderer to update its state
      sendThumbnailModeToRenderer(mode);
  });

  // Listener for main process requesting current mode from renderer
  ipcMain.on('request-renderer-thumbnail-mode', (event) => {
    event.sender.send('update-thumbnail-render-mode', currentThumbnailRenderMode);
  });

  // ... existing ipcMain handlers ...

  ipcMain.on('discover-dacs', (event, networkInterface) => {
    discoverDacs((dacs) => {
      if(mainWindow) mainWindow.webContents.send('dacs-discovered', dacs);
    }, networkInterface);
  });

  ipcMain.handle('get-network-interfaces', () => {
    return getNetworkInterfaces();
  });

  ipcMain.on('stop-dac-discovery', () => {
    stopDiscovery();
  });

  ipcMain.on('send-frame', (event, { ip, channel, frame, fps, ildaFormat }) => {
    sendFrame(ip, channel, frame, fps, ildaFormat);
  });

  ipcMain.on('send-play-command', (event, ip) => {
    sendPlayCommand(ip);
  });

  ipcMain.on('show-layer-context-menu', (event, index) => {
    const layerContextMenu = Menu.buildFromTemplate([
      { label: 'Rename Layer', click: () => { if(mainWindow) mainWindow.webContents.send('context-menu-action', { type: 'rename-layer', index: index }); } },
    ]);
    layerContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-layer-full-context-menu', (event, layerIndex) => {
    console.log(`Received show-layer-full-context-menu for layer: ${layerIndex}`);
    const layerFullContextMenu = Menu.buildFromTemplate([
      { label: 'Insert Above', click: () => { if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'layer-insert-above', layerIndex); } },
      { label: 'Insert Below', click: () => { if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'layer-insert-below', layerIndex); } },
      { type: 'separator' },
      {
        label: 'Set Thumbnail Mode',
        submenu: [
            {
                label: 'Still Frame',
                type: 'radio',
                checked: currentThumbnailRenderMode === 'still',
                click() {
                    currentThumbnailRenderMode = 'still';
                    sendThumbnailModeToRenderer('still'); // Send to renderer to update state
                    if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'set-layer-thumbnail-mode-still', layerIndex);
                    buildApplicationMenu(currentThumbnailRenderMode); // Rebuild main menu
                }
            },
            {
                label: 'Live Render',
                type: 'radio',
                checked: currentThumbnailRenderMode === 'active',
                click() {
                    currentThumbnailRenderMode = 'active';
                    sendThumbnailModeToRenderer('active'); // Send to renderer to update state
                    if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'set-layer-thumbnail-mode-active', layerIndex);
                    buildApplicationMenu(currentThumbnailRenderMode); // Rebuild main menu
                }
            }
        ]
      },
      { type: 'separator' },
      { label: 'Rename', click: () => { if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'layer-rename', layerIndex); } },
      { label: 'Clear Clips', click: () => { if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'layer-clear-clips', layerIndex); } },
    ]);
    layerFullContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-column-context-menu', (event, index) => {
    const columnContextMenu = Menu.buildFromTemplate([
      { label: 'Rename Column', click: () => { if(mainWindow) mainWindow.webContents.send('context-menu-action', { type: 'rename-column', index: index }); } },
    ]);
    columnContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-clip-context-menu', (event, layerIndex, colIndex) => {
    console.log(`Received show-clip-context-menu for layer: ${layerIndex}, column: ${colIndex}`); // Add log
    const clipContextMenu = Menu.buildFromTemplate([
      { label: 'Update Thumbnail', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'update-thumbnail', layerIndex, colIndex }); } },
      { type: 'separator' },
      {
        label: 'Set Thumbnail Mode',
        submenu: [
            {
                label: 'Still Frame',
                type: 'radio',
                checked: currentThumbnailRenderMode === 'still',
                click() {
                    currentThumbnailRenderMode = 'still';
                    sendThumbnailModeToRenderer('still'); // Send to renderer to update state
                    if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'set-clip-thumbnail-mode-still', layerIndex, colIndex });
                    buildApplicationMenu(currentThumbnailRenderMode); // Rebuild main menu
                }
            },
            {
                label: 'Live Render',
                type: 'radio',
                checked: currentThumbnailRenderMode === 'active',
                click() {
                    currentThumbnailRenderMode = 'active';
                    sendThumbnailModeToRenderer('active'); // Send to renderer to update state
                    if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'set-clip-thumbnail-mode-active', layerIndex, colIndex });
                    buildApplicationMenu(currentThumbnailRenderMode); // Rebuild main menu
                }
            }
        ]
      },
      { type: 'separator' },
      { label: 'Cut', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'cut-clip', layerIndex, colIndex }); } },
      { label: 'Copy', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'copy-clip', layerIndex, colIndex }); } },
      { label: 'Paste', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'paste-clip', layerIndex, colIndex }); } },
      { type: 'separator' },
      { label: 'Rename', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'rename-clip', layerIndex, colIndex }); } },
      { label: 'Clear', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', { command: 'clear-clip', layerIndex, colIndex }); } },
    ]);
    clipContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-column-header-clip-context-menu', (event, colIndex) => {
    console.log(`Received show-column-header-clip-context-menu for column: ${colIndex}`);
    const columnHeaderClipContextMenu = Menu.buildFromTemplate([
      { label: 'Update Thumbnail', click: () => { if(mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'update-thumbnail', colIndex }); } },
      { type: 'separator' },
      { label: 'Cut', click: () => { if(mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'cut-clip', colIndex }); } },
      { label: 'Copy', click: () => { if(mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'copy-clip', colIndex }); } },
      { label: 'Paste', click: () => { if(mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'paste-clip', colIndex }); } },
      { type: 'separator' },
      { label: 'Rename', click: () => { if(mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'rename-clip', colIndex }); } },
      { label: 'Clear', click: () => { if(mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'clear-column-clips', colIndex }); } },
    ]);
    columnHeaderClipContextMenu.popup({ window: mainWindow });
  });

  // Listen for context menu actions from renderer and send back to renderer
  ipcMain.on('context-menu-action', (event, action) => {
    console.log(`Main process received context menu action: ${JSON.stringify(action)}`);
    if(mainWindow) mainWindow.webContents.send('context-menu-action-from-main', action);
  });

  ipcMain.handle('open-file-explorer', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

  ipcMain.handle('read-file-content', async (event, filePath) => {
    try {
      const content = await fs.promises.readFile(filePath);
      return content;
    } catch (error) {
      console.error('Failed to read file content:', error);
      return null;
    }
  });

  ipcMain.handle('read-ild-files', async (event, directoryPath) => {
    try {
      const files = await fs.promises.readdir(directoryPath);
      const ildFiles = files
        .filter(file => file.toLowerCase().endsWith('.ild'))
        .map(file => path.join(directoryPath, file));
      return ildFiles;
    } catch (error) {
      console.error('Failed to read directory:', error);
      return [];
    }
  });
  ipcMain.handle('read-file-as-binary', async (event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return buffer;
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopSending(); // Close the sending socket
    app.quit();
  }
});