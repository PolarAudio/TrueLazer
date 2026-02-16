import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import url, { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import fs from 'fs';
import os from 'os';
import pidusage from 'pidusage';
import psTree from 'ps-tree';
import Store from 'electron-store'; // No .default needed for ESM
import https from 'https';
import getSystemFonts from 'get-system-fonts';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ES module equivalent of __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import dacCommunication from './main/dac-communication.cjs';
const { discoverDacs, sendFrame, getNetworkInterfaces, getDacServices, closeAll, stopSending, setDacStatusCallback } = dacCommunication;

// Setup DAC Status Listener
setDacStatusCallback((ip, status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('dac-status', { ip, status });
    }
});

// Load Native NDI Wrapper
let ndi;
try {
    const nativeModulePath = app.isPackaged 
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'build', 'Release')
        : path.join(__dirname, 'native', 'build', 'Release');

    // On Windows, we need to ensure the DLL is in the search path
    if (process.platform === 'win32') {
        process.env.PATH = nativeModulePath + path.delimiter + process.env.PATH;
    }

    const ndiModule = require(path.join(nativeModulePath, 'ndi_wrapper.node'));
    ndi = new ndiModule.NdiWrapper();
    console.log('NDI Wrapper loaded successfully from:', nativeModulePath);
    if (ndi.initialize()) {
        console.log('NDI initialized');
    } else {
        console.error('Failed to initialize NDI');
    }
} catch (e) {
    console.error('Failed to load NDI wrapper:', e);
}

// Fix for "Unable to move the cache: Zugriff verweigert (0x5)"
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
// Suppress Autofill.enable and Autofill.setAddresses errors in console
app.commandLine.appendSwitch('disable-autofill');

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
      beamRenderMode: { type: 'string', default: 'both' },
      worldShowBeamEffect: { type: 'boolean', default: true },
      worldBeamRenderMode: { type: 'string', default: 'both' },
      previewScanRate: { type: 'number', default: 1 },
      fadeAlpha: { type: 'number', default: 0.1 },
      beamAlpha: { type: 'number', default: 0.1 }
    },
    default: {}
  },
  theme: { type: 'string', default: 'orange' },
  thumbnailRenderMode: { type: 'string', default: 'still' },
  midiMappings: { type: 'object', default: {} },
  artnetMappings: { type: 'object', default: {} },
  keyboardMappings: { type: 'object', default: {} },
  selectedMidiInputId: { type: 'string', default: '' },
  shortcutsState: {
    type: 'object',
    properties: {
      midi: { type: 'boolean' },
      artnet: { type: 'boolean' },
      osc: { type: 'boolean' },
      keyboard: { type: 'boolean' }
    },
    default: {
      midi: false,
      artnet: false,
      osc: false,
      keyboard: false
    }
  },
  selectedDac: {
    anyOf: [
      { type: 'object' },
      { type: 'null' }
    ],
    default: null
  },
  loadedClips: { type: 'array', default: [] }, // Reverted to original
  clipNames: { type: 'array', default: [] },
  dacOutputSettings: { type: 'object', default: {} },
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

// Initialize electron-store
const store = new Store({ schema });
// store.clear(); // Uncomment to clear store on startup for debugging

let shortcutsState = store.get('shortcutsState');

// Global variables for ArtNet and OSC
let artnetInstance = null;
let artnetSender = null; // We might need multiple senders for multiple universes
let artnetReceivers = new Map(); // Map universe number to receiver instance
let oscUdpPort = null;

const getOrCreateReceiver = (universe) => {
    if (artnetReceivers.has(universe)) return artnetReceivers.get(universe);
    
    const receiver = artnetInstance.newReceiver({
        subnet: 0,
        universe: universe,
        net: 0
    });

    receiver.on('data', (data) => {
        if (mainWindow) {
            mainWindow.webContents.send('artnet-data-received', { universe, data });
        }
    });

    artnetReceivers.set(universe, receiver);
    return receiver;
};

// IPC handlers for ArtNet
ipcMain.handle('initialize-artnet', async () => {
  try {
    if (!artnetInstance) {
      const dmxlib = await import('dmxnet');
      // dmxnet exports an object with a 'dmxnet' property which is the actual class
      const DMXnet = dmxlib.dmxnet || (dmxlib.default && dmxlib.default.dmxnet) || dmxlib.default || dmxlib; 
      
      artnetInstance = new DMXnet({
        log: { level: 'error' } 
      });
      // Initialize a default sender for Universe 0
      artnetSender = artnetInstance.newSender({
        ip: "255.255.255.255", 
        subnet: 0,
        universe: 0,
        net: 0
      });

      // Initialize a receiver for Universe 0 by default
      getOrCreateReceiver(0);
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to initialize ArtNet:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.on('artnet-listen-universe', (event, universe) => {
    if (artnetInstance) {
        getOrCreateReceiver(universe);
    }
});

ipcMain.handle('get-artnet-mappings', () => {
  return store.get('artnetMappings') || {};
});

ipcMain.handle('save-artnet-mappings', (event, mappings) => {
  store.set('artnetMappings', mappings);
  return { success: true };
});

ipcMain.handle('export-mappings', async (event, mappings, type) => {
    const documentsPath = app.getPath('documents');
    const userMappingsPath = path.join(documentsPath, 'TrueLazer', 'Mappings');
    const defaultPath = path.join(userMappingsPath, `TrueLazer_${type}_Mappings.json`);
    
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `Export ${type.toUpperCase()} Mappings`,
      defaultPath,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (canceled || !filePath) return false;

    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(mappings, null, 2));
      return true;
    } catch (error) {
      console.error(`Failed to export ${type} mappings:`, error);
      return false;
    }
  });

  ipcMain.handle('import-mappings', async (event, type) => {
    const documentsPath = app.getPath('documents');
    const userMappingsPath = path.join(documentsPath, 'TrueLazer', 'Mappings');
    
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: `Import ${type.toUpperCase()} Mappings`,
      defaultPath: userMappingsPath,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return { success: false };

    try {
      const data = await fs.promises.readFile(filePaths[0], 'utf-8');
      const mappings = JSON.parse(data);
      return { success: true, mappings };
    } catch (error) {
      console.error(`Failed to import ${type} mappings:`, error);
      return { success: false, error: error.message };
    }
  });

// Commented out to avoid issues with schema

ipcMain.handle('get-artnet-universes', () => {
  // Return a list of 16 universes
  return Array.from({ length: 16 }, (_, i) => ({
    id: `universe-${i}`,
    name: `Universe ${i}${i === 0 ? ' (Default)' : ''}`
  }));
});

ipcMain.on('send-artnet-data', (event, universe, channel, value) => {
  if (artnetSender) {
    try {
        artnetSender.prepChannel(channel, value);
        artnetSender.transmit();
    } catch (e) {
        console.error("ArtNet Send Error:", e);
    }
  }
});

ipcMain.on('close-artnet', () => {
  if (artnetInstance) {
    artnetInstance = null;
    artnetSender = null;
  }
});

// IPC handlers for OSC
ipcMain.handle('initialize-osc', async (event, config) => {
  try {
    const osc = (await import('osc')).default;
    
    if (oscUdpPort) {
      oscUdpPort.close();
    }

    oscUdpPort = new osc.UDPPort({
      localAddress: "0.0.0.0",
      localPort: config.localPort || 57121,
      remoteAddress: config.remoteAddress || "127.0.0.1",
      remotePort: config.remotePort || 57120,
      metadata: true
    });

    oscUdpPort.on("message", (oscMessage) => {
      if(mainWindow) mainWindow.webContents.send('osc-message-received', { oscMessage });
    });

    oscUdpPort.on("error", (error) => {
      console.error("OSC Error:", error);
    });

    oscUdpPort.open();
    return { success: true };
  } catch (error) {
    console.error('Failed to initialize OSC:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.on('send-osc-message', (event, address, args) => {
  if (oscUdpPort) {
    oscUdpPort.send({
      address: address,
      args: args // args should be array of { type, value } or inferred
    });
  }
});

ipcMain.on('close-osc', () => {
  if (oscUdpPort) {
    oscUdpPort.close();
    oscUdpPort = null;
  }
});

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
  if (dac && dac.ip) {
    dacCommunication.connectDac(dac.ip, dac.type);
  }
});

ipcMain.handle('get-midi-mappings', () => {
  return store.get('midiMappings') || {};
});

ipcMain.handle('save-midi-mappings', (event, mappings) => {
  store.set('midiMappings', mappings);
  return { success: true };
});

ipcMain.handle('get-keyboard-mappings', () => {
  return store.get('keyboardMappings') || {};
});

ipcMain.handle('save-keyboard-mappings', (event, mappings) => {
  store.set('keyboardMappings', mappings);
  return { success: true };
});

ipcMain.handle('save-selected-midi-input', (event, inputId) => {
  store.set('selectedMidiInputId', inputId);
  return { success: true };
});

ipcMain.handle('get-selected-midi-input', () => {
  return store.get('selectedMidiInputId') || '';
});

ipcMain.handle('set-loaded-clips', (event, loadedClips) => {
  console.log('Received loadedClips:', loadedClips);
  store.set('loadedClips', loadedClips);
});

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

async function initializeUserData() {
  const documentsPath = app.getPath('documents');
  const userDataPath = path.join(documentsPath, 'TrueLazer');
  const userIldaPath = path.join(userDataPath, 'ILDA-FILES');
  const userMappingsPath = path.join(userDataPath, 'Mappings');
  
  try {
      await fs.promises.mkdir(userDataPath, { recursive: true });
      await fs.promises.mkdir(userIldaPath, { recursive: true });
      await fs.promises.mkdir(userMappingsPath, { recursive: true });

      // 1. Copy default ILDA assets
      const resourcePath = app.isPackaged 
          ? path.join(process.resourcesPath, 'ILDA-FILES')
          : path.join(__dirname, 'src', 'ILDA-FILE-FORMAT-FILES');

      if (fs.existsSync(resourcePath)) {
          const sourceFiles = await fs.promises.readdir(resourcePath);
          for (const file of sourceFiles) {
              const srcFile = path.join(resourcePath, file);
              const destFile = path.join(userIldaPath, file);
              try {
                  await fs.promises.access(destFile);
              } catch {
                  const stat = await fs.promises.stat(srcFile);
                  if (stat.isFile()) await fs.promises.copyFile(srcFile, destFile);
              }
          }
      }

      // 2. Copy default Mapping files
      let mappingSourcePath = path.join(__dirname, 'src');
      if (app.isPackaged) {
          const nextToExe = path.join(path.dirname(process.execPath), 'Mappings');
          const inResources = path.join(process.resourcesPath, 'Mappings');
          if (fs.existsSync(nextToExe)) mappingSourcePath = nextToExe;
          else if (fs.existsSync(inResources)) mappingSourcePath = inResources;
      }

      console.log(`[Init] Checking for default mappings in: ${mappingSourcePath}`);

      if (fs.existsSync(mappingSourcePath)) {
          const mappingFiles = await fs.promises.readdir(mappingSourcePath);
          for (const file of mappingFiles) {
              if (file.toLowerCase().endsWith('mappings.json')) {
                  const srcFile = path.join(mappingSourcePath, file);
                  const destFile = path.join(userMappingsPath, file);
                  try {
                      await fs.promises.access(destFile);
                  } catch {
                      console.log(`[Init] Copying default mapping: ${file}`);
                      await fs.promises.copyFile(srcFile, destFile);
                  }
              }
          }
      }

      return { userIldaPath, userMappingsPath };
  } catch (e) {
      console.warn("Could not initialize user data:", e);
      return { userIldaPath, userMappingsPath };
  }
}

ipcMain.handle('get-default-project-path', async () => {
  return await getDefaultProjectPath();
});

ipcMain.handle('get-user-ilda-path', async () => {
    const documentsPath = app.getPath('documents');
    return path.join(documentsPath, 'TrueLazer', 'ILDA-FILES');
});

ipcMain.handle('get-user-mappings-path', async () => {
    const documentsPath = app.getPath('documents');
    return path.join(documentsPath, 'TrueLazer', 'Mappings');
});

let currentProjectpath = null;

function updateWindowTitle() {
  if (!mainWindow) return;
  const baseTitle = 'TrueLazer';
  if (currentProjectpath) {
    const projectName = path.basename(currentProjectpath, '.tlp');
    mainWindow.setTitle(`${baseTitle} - ${projectName}`);
  } else {
    mainWindow.setTitle(`${baseTitle} - New Project`);
  }
}

// IPC handlers for project management
ipcMain.on('new-project', (event) => {
  currentProjectpath = null;
  updateWindowTitle();
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
    updateWindowTitle();
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
      updateWindowTitle();
    } catch (error) {
      console.error('Failed to save project file:', error);
    }
  } else {
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
    updateWindowTitle();
    try {
      await fs.promises.writeFile(currentProjectpath, JSON.stringify(projectData, null, 2));
    } catch (error) {
      console.error('Failed to save project file:', error);
    }
  }
});

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
        		{ label: 'Shape Builder', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'shapeBuilder'); } },
        		{ type: 'separator' },
        		{ label: 'Timeline Editor', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'timeline'); } },
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
          label: 'Audio Settings',
          submenu: [
            {
              label: 'Audio Output',
              submenu: audioDevices.length > 0 
                ? [
                    ...audioDevices.map(device => ({
                        label: device.label || `Device ${device.deviceId.slice(0, 5)}`,
                        type: 'radio',
                        checked: currentAudioDeviceId === device.deviceId,
                        click: () => {
                          currentAudioDeviceId = device.deviceId;
                          if(mainWindow) mainWindow.webContents.send('update-audio-device-id', device.deviceId);
                        }
                    })),
                    { type: 'separator' },
                    { label: 'Audio Output Settings...', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'settings-audio-output'); } }
                  ]
                : [{ label: 'No devices found', enabled: false }]
            },
            { label: 'FFT Settings...', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'settings-audio-fft'); } }
          ]
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
        {
          label: 'MIDI',
          type: 'checkbox',
          checked: shortcutsState.midi,
          click: () => {
            shortcutsState.midi = !shortcutsState.midi;
            store.set('shortcutsState', shortcutsState);
            if(mainWindow) mainWindow.webContents.send('menu-action', `toggle-midi-${shortcutsState.midi}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'MIDI Settings...',
          visible: shortcutsState.midi,
          click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'open-midi-settings'); }
        },
        { type: 'separator' },
        {
          label: 'ArtNet',
          type: 'checkbox',
          checked: shortcutsState.artnet,
          click: () => {
            shortcutsState.artnet = !shortcutsState.artnet;
            store.set('shortcutsState', shortcutsState);
            if(mainWindow) mainWindow.webContents.send('menu-action', `toggle-artnet-${shortcutsState.artnet}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'ArtNet Settings...',
          visible: shortcutsState.artnet,
          click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'open-artnet-settings'); }
        },
        { type: 'separator' },
        {
          label: 'OSC',
          type: 'checkbox',
          checked: shortcutsState.osc,
          click: () => {
            shortcutsState.osc = !shortcutsState.osc;
            store.set('shortcutsState', shortcutsState);
            if(mainWindow) mainWindow.webContents.send('menu-action', `toggle-osc-${shortcutsState.osc}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'OSC Settings...',
          visible: shortcutsState.osc,
          click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'open-osc-settings'); }
        },
        { type: 'separator' },
        {
          label: 'Keyboard',
          type: 'checkbox',
          checked: shortcutsState.keyboard,
          click: () => {
            shortcutsState.keyboard = !shortcutsState.keyboard;
            store.set('shortcutsState', shortcutsState);
            if(mainWindow) mainWindow.webContents.send('menu-action', `toggle-keyboard-${shortcutsState.keyboard}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'Keyboard Settings...',
          visible: shortcutsState.keyboard,
          click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'open-keyboard-settings'); }
        },
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
			{ label: 'Green', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-green'); } },
			{ label: 'White', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-white'); } },
          ]
        },
        {
          label: 'Render Mode',
          submenu: [
            { label: 'Thumbnail Still Frame', type: 'radio', checked: mode === 'still', click: () => { sendThumbnailModeToRenderer('still'); } },
            { label: 'Thumbnail Live Render', type: 'radio', checked: mode === 'active', click: () => { sendThumbnailModeToRenderer('active'); } },
            { label: 'Thumbnail Hover Render', type: 'radio', checked: mode === 'hover', click: () => { sendThumbnailModeToRenderer('hover'); } },
            { type: 'separator' },
            { label: 'Show Beam Effect', type: 'checkbox', checked: true, click: (menuItem) => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'showBeamEffect', value: menuItem.checked }); } },
            { type: 'separator' },
            {
              label: 'Display Mode',
              submenu: [
                { label: 'Points', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'points' }); } },
                { label: 'Lines', type: 'radio', click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'lines' }); } },
                { label: 'Points & Lines', type: 'radio', checked: true, click: () => { if(mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'both' }); } },
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
      webSecurity: false,
      backgroundThrottling: false,
    },
    frame: true,
  });

  win.webContents.openDevTools();

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadURL(url.format({
      pathname: path.join(__dirname, 'dist', 'index.html'),
      protocol: 'file:',
      slashes: true
    }));
  }

  mainWindow = win;

  win.on('closed', () => {
    mainWindow = null;
    dacCommunication.closeAll();
  });

  buildApplicationMenu(currentThumbnailRenderMode);

  ipcMain.on('renderer-thumbnail-mode-changed', (event, mode) => {
      currentThumbnailRenderMode = mode;
      buildApplicationMenu(currentThumbnailRenderMode);
  });

  ipcMain.on('update-thumbnail-render-mode', (event, mode) => {
      sendThumbnailModeToRenderer(mode);
  });

  ipcMain.on('request-renderer-thumbnail-mode', (event) => {
    event.sender.send('update-thumbnail-render-mode', currentThumbnailRenderMode);
  });

  ipcMain.handle('discover-dacs', async (event, timeout, networkInterfaceIp) => {
    return await discoverDacs(timeout, networkInterfaceIp);
  });

  ipcMain.handle('get-dac-services', async (event, ip, localIp, type) => {
    return await getDacServices(ip, localIp, 1000, type);
  });

  ipcMain.handle('send-frame', async (event, ip, channel, points, fps, type, options) => {
    sendFrame(ip, channel, points, fps, type, options);
  });

  ipcMain.handle('start-dac-output', async (event, ip, type) => {
    dacCommunication.startOutput(ip, type);
  });

  ipcMain.handle('stop-dac-output', async (event, ip, type) => {
    stopSending(ip, type);
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
                    sendThumbnailModeToRenderer('still');
                    if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'set-layer-thumbnail-mode-still', layerIndex);
                    buildApplicationMenu(currentThumbnailRenderMode);
                }
            },
            {
                label: 'Live Render',
                type: 'radio',
                checked: currentThumbnailRenderMode === 'active',
                click() {
                    currentThumbnailRenderMode = 'active';
                    sendThumbnailModeToRenderer('active');
                    if(mainWindow) mainWindow.webContents.send('layer-full-context-command', 'set-layer-thumbnail-mode-active', layerIndex);
                    buildApplicationMenu(currentThumbnailRenderMode);
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
      { label: 'Duplicate', click: () => { if(mainWindow) mainWindow.webContents.send('menu-action', 'column-duplicate'); } },
      { label: 'Rename Column', click: () => { if(mainWindow) mainWindow.webContents.send('context-menu-action', { type: 'rename-column', index: index }); } },
    ]);
    columnContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-clip-context-menu', (event, layerIndex, colIndex, currentTriggerStyle = 'normal') => {
    const clipContextMenu = Menu.buildFromTemplate([
      { label: 'Update Thumbnail', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'update-thumbnail', layerIndex, colIndex); } },
      { label: 'Export as ILDA', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'export-ilda', layerIndex, colIndex); } },
      { type: 'separator' },
      {
        label: 'Trigger Style',
        submenu: [
          { label: 'Normal', type: 'radio', checked: currentTriggerStyle === 'normal', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'set-trigger-style-normal', layerIndex, colIndex); } },
          { label: 'Toggle', type: 'radio', checked: currentTriggerStyle === 'toggle', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'set-trigger-style-toggle', layerIndex, colIndex); } },
          { label: 'Flash', type: 'radio', checked: currentTriggerStyle === 'flash', click: () => { if(mainWindow) mainWindow.webContents.send('clip-context-command', 'set-trigger-style-flash', layerIndex, colIndex); } },
        ]
      },
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
                    sendThumbnailModeToRenderer('still');
                    if(mainWindow) mainWindow.webContents.send('clip-context-command', 'set-clip-thumbnail-mode-still', layerIndex, colIndex);
                    buildApplicationMenu(currentThumbnailRenderMode);
                }
            },
            {
                label: 'Live Render',
                type: 'radio',
                checked: currentThumbnailRenderMode === 'active',
                click() {
                    currentThumbnailRenderMode = 'active';
                    sendThumbnailModeToRenderer('active');
                    if(mainWindow) mainWindow.webContents.send('clip-context-command', 'set-clip-thumbnail-mode-active', layerIndex, colIndex);
                    buildApplicationMenu(currentThumbnailRenderMode);
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

  ipcMain.on('show-quick-assign-context-menu', (event, type, index) => {
    const quickAssignMenu = Menu.buildFromTemplate([
      { label: 'Reset Value', click: () => { if(mainWindow) mainWindow.webContents.send('context-menu-action-from-main', { type: 'reset-quick-assign', controlType: type, index: index }); } },
      { label: 'Clear Assignment', click: () => { if(mainWindow) mainWindow.webContents.send('context-menu-action-from-main', { type: 'clear-quick-assign', controlType: type, index: index }); } },
    ]);
    quickAssignMenu.popup({ window: mainWindow });
  });

  ipcMain.on('context-menu-action', (event, action) => {
    if(mainWindow) mainWindow.webContents.send('context-menu-action-from-main', action);
  });

  ipcMain.handle('open-file-explorer', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('read-file-content', async (event, filePath) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
      return await fs.promises.readFile(fullPath);
    } catch (error) {
      console.error('Failed to read file content:', error);
      return null;
    }
  });

  ipcMain.handle('check-file-exists', async (event, filePath) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('read-ild-files', async (event, directoryPath) => {
    try {
      const fullPath = path.isAbsolute(directoryPath) ? directoryPath : path.join(__dirname, directoryPath);
      const files = await fs.promises.readdir(fullPath);
      return files.filter(file => file.toLowerCase().endsWith('.ild')).map(file => path.join(directoryPath, file));
    } catch (error) {
      console.error('Failed to read directory:', error);
      return [];
    }
  });

  ipcMain.handle('read-file-as-binary', async (event, filePath) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
      const buffer = await fs.promises.readFile(fullPath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  });

  ipcMain.handle('read-file-for-worker', async (event, filePath, maxBytes) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
      let buffer;
      if (maxBytes) {
          const fileHandle = await fs.promises.open(fullPath, 'r');
          const allocSize = Math.min(maxBytes, (await fileHandle.stat()).size);
          const { buffer: chunk } = await fileHandle.read(Buffer.alloc(allocSize), 0, allocSize, 0);
          await fileHandle.close();
          buffer = chunk;
      } else {
          buffer = await fs.promises.readFile(fullPath);
      }
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      console.error(`Error reading file for worker: ${filePath}`, error);
      throw error;
    }
  });

  ipcMain.handle('get-system-fonts', async () => {
    try { return await getSystemFonts(); } catch (error) { return []; }
  });

  ipcMain.handle('get-project-fonts', async () => {
    const fontsDir = app.isPackaged ? path.join(process.resourcesPath, 'fonts') : path.join(__dirname, 'src', 'fonts');
    try {
      await fs.promises.access(fontsDir);
      const files = await fs.promises.readdir(fontsDir);
      return files.filter(file => /\.(ttf|otf|ttc)$/i.test(file)).map(file => ({ name: file, path: path.join(fontsDir, file) }));
    } catch (error) { return []; }
  });

  ipcMain.handle('show-font-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Font',
      defaultPath: path.join(__dirname, 'src', 'fonts'),
      filters: [{ name: 'Font Files', extensions: ['ttf', 'otf', 'ttc'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile', 'noResolveAliases']
    });
    return (canceled || filePaths.length === 0) ? null : filePaths[0];
  });

  ipcMain.handle('show-audio-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile']
    });
    return (canceled || filePaths.length === 0) ? null : filePaths[0];
  });

  ipcMain.handle('show-open-dialog', async (event, options) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, options);
      return (canceled || filePaths.length === 0) ? null : filePaths[0];
  });

  ipcMain.handle('fetch-url-as-arraybuffer', async (event, url) => {
    try {
      const buffer = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            https.get(res.headers.location, (redirectRes) => {
              const chunks = [];
              redirectRes.on('data', chunk => chunks.push(chunk));
              redirectRes.on('end', () => resolve(Buffer.concat(chunks).buffer));
            });
          } else {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).buffer));
          }
        }).on('error', reject);
      });
      return buffer;
    } catch (error) { throw error; }
  });

  ipcMain.handle('save-thumbnail', async (event, arrayBuffer, filename) => {
    try {
      const tempPath = path.join(app.getPath('userData'), 'thumbnails');
      await fs.promises.mkdir(tempPath, { recursive: true });
      const filePath = path.join(tempPath, filename);
      await fs.promises.writeFile(filePath, Buffer.from(arrayBuffer));
      return filePath;
    } catch (error) { throw error; }
  });

  ipcMain.handle('save-ilda-file', async (event, arrayBuffer, defaultName = 'export.ild') => {
    const userIldaPath = path.join(app.getPath('documents'), 'TrueLazer', 'ILDA-FILES');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export ILDA File',
      defaultPath: path.join(userIldaPath, defaultName),
      filters: [{ name: 'ILDA Files', extensions: ['ild'] }]
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    try {
      await fs.promises.writeFile(filePath, Buffer.from(arrayBuffer));
      return { success: true, filePath };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('delete-thumbnail', async (event, filePath) => {
      try {
          if (!filePath) return { success: false };
          const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails');
          if (!filePath.startsWith(thumbnailsDir)) return { success: false, error: 'Access denied' };
          await fs.promises.unlink(filePath);
          return { success: true };
      } catch (error) { return { success: true }; }
  });

  // NDI IPC Handlers
  let ndiCaptureSettings = { width: 480, height: 480 };
  let ndiPerformanceData = { totalTime: 0, count: 0, lastReport: Date.now() };
  let isRendererReadyForNdi = true;

  ipcMain.handle('ndi-update-settings', (event, settings) => {
      if (settings.width) ndiCaptureSettings.width = settings.width;
      if (settings.height) ndiCaptureSettings.height = settings.height;
      // Immediately update active capture resolution
      if (ndi) {
          ndi.startCapture(ndiCaptureSettings.width, ndiCaptureSettings.height);
      }
      return true;
  });

  ipcMain.handle('ndi-find-sources', async () => {
      if (!ndi) return [];
      return ndi.findSources();
  });

  ipcMain.handle('ndi-create-receiver', async (event, sourceName) => {
      if (!ndi) return false;
      const success = ndi.createReceiver(sourceName);
      if (success) {
          ndi.startCapture(ndiCaptureSettings.width, ndiCaptureSettings.height);
          isRendererReadyForNdi = true; 
      }
      return success;
  });

  ipcMain.handle('ndi-capture-video', async () => {
      if (!ndi) return null;
      return ndi.captureVideo();
  });

  ipcMain.handle('ndi-destroy-receiver', async () => {
      if (!ndi) return;
      ndi.stopCapture();
      ndi.destroyReceiver();
      isRendererReadyForNdi = true; 
      ndiPerformanceData = { totalTime: 0, count: 0, lastReport: Date.now() };
  });

  ipcMain.on('ndi-renderer-ready', () => {
      isRendererReadyForNdi = true;
  });

  // Background System Stats Loop
  const sendSystemStats = async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
          try {
              psTree(process.pid, (err, children) => {
                  const pids = [process.pid, ...(err ? [] : children.map(p => parseInt(p.PID)).filter(pid => !isNaN(pid)))];
                  pidusage(pids, (err, stats) => {
                      if (err || !stats) return;
                      let totalCpu = 0;
                      let totalMemKB = 0;
                      const numCores = os.cpus().length || 1;
                      Object.values(stats).forEach(s => { 
                          totalCpu += s.cpu; 
                          totalMemKB += s.memory;
                      });
                      const normalizedCpu = totalCpu / numCores;
                      if (mainWindow && !mainWindow.isDestroyed()) {
                          mainWindow.webContents.send('system-stats', {
                              cpu: normalizedCpu.toFixed(1),
                              ram: (totalMemKB / (1024 * 1024)).toFixed(0)
                          });
                      }
                  });
              });
          } catch (e) {
              console.error("Error in system stats:", e);
          }
      }
  };
  setInterval(sendSystemStats, 2000); 

  let ndiFlowControlTimeout = null;

  const ndiCaptureLoop = async () => {
      if (ndi && mainWindow && !mainWindow.isDestroyed() && isRendererReadyForNdi) {
          const start = performance.now();
          const frame = ndi.captureVideo(ndiCaptureSettings.width, ndiCaptureSettings.height); 
          const end = performance.now();
          if (frame) {
              isRendererReadyForNdi = false; 
              if (ndiFlowControlTimeout) clearTimeout(ndiFlowControlTimeout);
              ndiFlowControlTimeout = setTimeout(() => { isRendererReadyForNdi = true; }, 200);
              const duration = end - start;
              ndiPerformanceData.totalTime += duration;
              ndiPerformanceData.count++;
              if (Date.now() - ndiPerformanceData.lastReport > 5000 && ndiPerformanceData.count > 0) {
                  const avg = ndiPerformanceData.totalTime / ndiPerformanceData.count;
                  console.log(`[NDI Performance] Avg Capture Time: ${avg.toFixed(2)}ms (over ${ndiPerformanceData.count} frames) @ ${frame.width}x${frame.height}`);
                  mainWindow.webContents.send('ndi-telemetry', { avgCaptureTime: avg });
                  ndiPerformanceData.totalTime = 0;
                  ndiPerformanceData.count = 0;
                  ndiPerformanceData.lastReport = Date.now();
              }
              mainWindow.webContents.send('ndi-frame', frame);
          }
      }
      const delay = isRendererReadyForNdi ? 2 : 16; 
      setTimeout(ndiCaptureLoop, delay);
  };
  ndiCaptureLoop();
}

app.whenReady().then(async () => {
  await initializeUserData();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (ndi) {
      ndi.destroyReceiver();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
