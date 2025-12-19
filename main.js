import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import url, { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import fs from 'fs';
import Store from 'electron-store'; // No .default needed for ESM
import https from 'https';
import * as dacCommunication from './main/dac-communication.cjs';
const { discoverDacs, sendFrame, getNetworkInterfaces, getDacServices } = dacCommunication;

// ES module equivalent of __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

let mainWindow; // Global variable to store the main window instance
let currentThumbnailRenderMode = 'still'; // Global variable to store the current thumbnail render mode
let audioDevices = []; // Global variable to store audio devices
let currentAudioDeviceId = 'default';

// Define the schema for settings
const schema = {
  renderSettings: {
    type: 'object',
    properties: {
      showBeamEffect: { type: 'boolean', default: true },
      beamRenderMode: { type: 'string', default: 'points' },
      previewScanRate: { type: 'number', default: 1 },
      fadeAlpha: { type: 'number', default: 0.1 },
      beamAlpha: { type: 'number', default: 0.1 }
    },
    default: {}
  },
  theme: { type: 'string', default: 'orange' },
  loadedClips: { type: 'array', default: [] }, // Reverted to original
  sliderValue: { type: 'object', default: {} }, // Placeholder for slider values
  dacAssignment: { type: 'object', default: {} }, // Placeholder for DAC assignments
  lastOpenedProject: {
    anyOf: [
      { type: 'string' },
      { type: 'null' }
    ],
    default: null
  },
};

// Temporarily disable electron-store for debugging
// const store = new Store({ schema });
// store.clear();
const store = { // Dummy store
  store: {},
  get: (key) => ({}),
  set: (key, value) => console.log(`Dummy store: Setting ${key} to`, value),
  clear: () => console.log('Dummy store: Clearing')
};

// IPC handlers for settings
ipcMain.handle('get-all-settings', (event) => {
  return store.store;
});

ipcMain.handle('set-render-settings', (event, renderSettings) => {
  store.set('renderSettings', renderSettings);
});

ipcMain.handle('set-theme', (event, theme) => {
  store.set('theme', theme);
});

ipcMain.handle('set-thumbnail-render-mode', (event, mode) => {
  store.set('thumbnailRenderMode', mode);
});

ipcMain.handle('set-selected-dac', (event, dac) => {
  store.set('selectedDac', dac);
});

/* // Commented out to avoid issues with schema
ipcMain.handle('set-loaded-clips', (event, loadedClips) => {
  console.log('Received loadedClips:', loadedClips);
  store.set('loadedClips', loadedClips);
});
*/

// Function to get or create the default project path
async function getDefaultProjectPath() {
  const documentsPath = app.getPath('documents');
  const projectPath = path.join(documentsPath, 'TrueLazer', 'Projects');

  try {
    await fs.promises.mkdir(projectPath, { recursive: true });
    return projectPath;
  } catch (error) {
    console.error('Failed to create default project path:', error);
    return null;
  }
}

// IPC handler to expose the default project path to the renderer
ipcMain.handle('get-default-project-path', async () => {
  return await getDefaultProjectPath();
});

let currentProjectpath = null;

// IPC handlers for project management
ipcMain.on('new-project', (event) => {
  currentProjectpath = null;
  if(mainWindow) mainWindow.webContents.send('new-project');
});

ipcMain.on('open-project', async (event) => {
  const defaultPath = await getDefaultProjectPath();
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    defaultPath,
    filters: [{ name: 'TrueLazer Projects', extensions: ['tlp'] }],
    properties: ['openFile'],
  });
  if (!canceled && filePaths.length > 0) {
    currentProjectpath = filePaths[0];
    try {
      const data = await fs.promises.readFile(currentProjectpath, 'utf-8');
      if(mainWindow) mainWindow.webContents.send('load-project-data', JSON.parse(data));
    } catch (error) {
      console.error('Failed to open project file:', error);
    }
  }
});

ipcMain.on('save-project', async (event, projectData) => {
  if (currentProjectpath) {
    try {
      await fs.promises.writeFile(currentProjectpath, JSON.stringify(projectData, null, 2));
    } catch (error) {
      console.error('Failed to save project file:', error);
    }
  } else {
    // If there's no current path, then we do a "Save As" instead.
    if(mainWindow) mainWindow.webContents.send('save-project-as');
  }
});

ipcMain.on('save-project-as', async (event, projectData) => {
  const defaultPath = await getDefaultProjectPath();
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [{ name: 'TrueLazer Projects', extensions: ['tlp'] }],
  });
  if (!canceled && filePath) {
    currentProjectpath = filePath;
    try {
      await fs.promises.writeFile(currentProjectpath, JSON.stringify(projectData, null, 2));
    } catch (error) {
      console.error('Failed to save project file:', error);
    }
  }
});

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
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => { if(mainWindow) mainWindow.webContents.send('new-project'); } },
        { label: 'Open Project', accelerator: 'CmdOrCtrl+O', click: () => { ipcMain.emit('open-project'); } },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => { if(mainWindow) mainWindow.webContents.send('save-project'); } },
        { label: 'Save Project As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => { if(mainWindow) mainWindow.webContents.send('save-project-as'); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { app.quit(); } },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'General', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'settings-general'); } },
        {
          label: 'Audio Output',
          submenu: audioDevices.length > 0 
            ? audioDevices.map(device => ({
                label: device.label || `Device ${device.deviceId.slice(0, 5)}`,
                type: 'radio',
                checked: currentAudioDeviceId === device.deviceId,
                click: () => {
                  currentAudioDeviceId = device.deviceId;
                  if(mainWindow) mainWindow.webContents.send('update-audio-device-id', device.deviceId);
                }
              }))
            : [{ label: 'No devices found', enabled: false }]
        }
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
      preload: path.join(__dirname, 'src', 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
      webSecurity: false, // Ensure this is false to allow file:// protocol for media
    },
    frame: true, // Set to false to remove the default window frame and title bar
  });

  // Always open DevTools in the built application to help debug blank screen issues.
  win.webContents.openDevTools();

  if (isDev) {
    win.loadURL('http://localhost:5173'); // Vite development server default port
  } else {
    // Use url.format for robust file loading from ASAR
    win.loadURL(url.format({
      pathname: path.join(__dirname, 'dist', 'index.html'),
      protocol: 'file:',
      slashes: true
    }));
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

  ipcMain.handle('discover-dacs', async (event, timeout, networkInterfaceIp) => {
    return await discoverDacs(timeout, networkInterfaceIp);
  });

  ipcMain.handle('get-dac-services', async (event, ip, localIp) => {
    return await getDacServices(ip, localIp);
  });

  ipcMain.handle('send-frame', async (event, ip, channel, frame, fps) => {
    sendFrame(ip, channel, frame, fps);
  });

  ipcMain.handle('get-network-interfaces', async () => {
    return getNetworkInterfaces();
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
      { label: 'Update Thumbnail', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'update-thumbnail', layerIndex, colIndex); } },
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
                    if(mainWindow) mainWindow.webContents.send('clip-context-command', 'set-clip-thumbnail-mode-still', layerIndex, colIndex);
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
                    if(mainWindow) mainWindow.webContents.send('clip-context-command', 'set-clip-thumbnail-mode-active', layerIndex, colIndex);
                    buildApplicationMenu(currentThumbnailRenderMode); // Rebuild main menu
                }
            }
        ]
      },
      { type: 'separator' },
      { label: 'Cut', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'cut-clip', layerIndex, colIndex); } },
      { label: 'Copy', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'copy-clip', layerIndex, colIndex); } },
      { label: 'Paste', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'paste-clip', layerIndex, colIndex); } },
      { type: 'separator' },
      { label: 'Rename', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'rename-clip', layerIndex, colIndex); } },
      { label: 'Clear', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'clear-clip', layerIndex, colIndex); } },
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

  ipcMain.on('set-audio-devices', (event, devices) => {
    audioDevices = devices;
    buildApplicationMenu(currentThumbnailRenderMode);
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

  ipcMain.handle('read-file-for-worker', async (event, filePath) => {
    try {
      const buffer = await fs.promises.readFile(filePath);
      // Convert Node.js Buffer to ArrayBuffer for transfer to worker
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      return arrayBuffer;
    } catch (error) {
      console.error(`Error reading file for worker: ${filePath}`, error);
      throw error;
    }
  });

  ipcMain.handle('show-font-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: 'C:\\Windows\\Fonts',
      filters: [
        { name: 'Font Files', extensions: ['ttf', 'otf'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    return filePaths[0];
  });

  ipcMain.handle('show-audio-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    return filePaths[0];
  });

  ipcMain.handle('fetch-url-as-arraybuffer', async (event, url) => {
    try {
      const buffer = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          // Follow redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            https.get(res.headers.location, (redirectRes) => {
              if (redirectRes.statusCode < 200 || redirectRes.statusCode >= 300) {
                return reject(new Error(`Failed to fetch URL: Status Code ${redirectRes.statusCode}`));
              }
              const chunks = [];
              redirectRes.on('data', chunk => chunks.push(chunk));
              redirectRes.on('end', () => {
                const nodeBuffer = Buffer.concat(chunks);
                const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
                resolve(arrayBuffer);
              });
            }).on('error', (err) => reject(err));
          } else if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Failed to fetch URL: Status Code ${res.statusCode}`));
          } else {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
              const nodeBuffer = Buffer.concat(chunks);
              const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
              resolve(arrayBuffer);
            });
          }
        }).on('error', (err) => {
          reject(err);
        });
      });
      return buffer;
    } catch (error) {
      console.error(`Failed to fetch URL ${url}:`, error);
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
    app.quit();
  }
});