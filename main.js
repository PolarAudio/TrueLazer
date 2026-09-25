import { app, BrowserWindow, Menu, ipcMain, dialog, session } from 'electron';
import url, { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import fs from 'fs';
import os from 'os';
import pidusage from 'pidusage';
import psTree from 'ps-tree';
import Store from 'electron-store'; // No .default needed for ESM
import https from 'https';
import getSystemFonts from 'get-system-fonts';
import { execFile } from 'child_process';
import dgram from 'dgram';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { decodeProlinkPacket } = require('./src/utils/prodjBeats.js');

// ES module equivalent of __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import dacCommunication from './main/dac-communication.cjs';
const { discoverDacs, sendFrame, sendIdleFrame, getNetworkInterfaces, getDacServices, closeAll, stopSending, setDacStatusCallback } = dacCommunication;

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

// Persistent main-process log. Packaged Electron apps have no visible console,
// so on a silent crash everything is lost. Mirror console output to
// %APPDATA%/TrueLazer/logs/main.log to make future crashes diagnosable.
const startFileLog = () => {
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.promises.mkdir(logDir, { recursive: true })
    .then(() => {
      const logPath = path.join(logDir, 'main.log');
      const stamp = () => new Date().toISOString();
      ['error', 'warn', 'log', 'info', 'debug'].forEach(level => {
        const original = console[level];
        console[level] = (...args) => {
          original(...args);
          try {
            const line = args.map(a => {
              if (a instanceof Error) return a.stack || a.message;
              try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
            }).join(' ');
            fs.appendFile(logPath, `[${stamp()}] [${level.toUpperCase()}] ${line}\n`, () => {});
          } catch { /* logging must never crash the app */ }
        };
      });
    });
};

// Defensive safety net: async errors from third-party/legacy modules (e.g.
// pidusage/ps-tree spawning a removed wmic.exe) would otherwise kill the whole
// app. Log them instead of crashing.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

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
  selectedAudioInputDeviceId: { type: 'string', default: 'default' },
  fftSettings: { type: 'object', default: {} },
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
  dacGroups: { type: 'object', default: {} },
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
  prolinkSettings: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: false },
      deviceId: { type: 'string', default: '' },
      selectedDevice: { type: 'string', default: '' },
      bpmSource: { type: 'string', default: 'prolink' },
    },
    default: {
      enabled: false,
      deviceId: '',
      selectedDevice: '',
      bpmSource: 'prolink',
    }
  },
  stagelinqSettings: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: false },
      deviceId: { type: 'string', default: '' },
      selectedDevice: { type: 'string', default: '' },
      bpmSource: { type: 'string', default: 'stagelinq' },
    },
    default: {
      enabled: false,
      deviceId: '',
      selectedDevice: '',
      bpmSource: 'stagelinq',
    }
  },
};

// Initialize electron-store
const store = new Store({ schema });
// store.clear(); // Uncomment to clear store on startup for debugging

let shortcutsState = store.get('shortcutsState');

let prolinkSettings = store.get('prolinkSettings') || { enabled: false, deviceId: '', selectedDevice: '', bpmSource: 'prolink' };
let stagelinqSettings = store.get('stagelinqSettings') || { enabled: false, deviceId: '', selectedDevice: '', bpmSource: 'stagelinq' };

// Global variables for ArtNet and OSC
let artnetInstance = null;
let artnetSender = null;
let artnetReceivers = new Map();
let artnetUniverseBuffers = new Map();
let artnetDirtyUniverses = new Set();
let artnetThrottler = null;
let oscUdpPort = null;

const getOrCreateReceiver = (universe) => {
  if (artnetReceivers.has(universe)) return artnetReceivers.get(universe);

  const receiver = artnetInstance.newReceiver({
    subnet: 0,
    universe: universe,
    net: 0
  });

  receiver.on('data', (data) => {
    artnetUniverseBuffers.set(universe, data);
    artnetDirtyUniverses.add(universe);
  });

  artnetReceivers.set(universe, receiver);
  return receiver;
};

const startArtnetThrottler = () => {
  if (artnetThrottler) return;
  artnetThrottler = setInterval(() => {
    if (artnetDirtyUniverses.size === 0 || !mainWindow || mainWindow.isDestroyed()) return;
    artnetDirtyUniverses.forEach(universe => {
      const data = artnetUniverseBuffers.get(universe);
      if (data) mainWindow.webContents.send('artnet-data-received', { universe, data });
    });
    artnetDirtyUniverses.clear();
  }, 30);
};

const stopArtnetThrottler = () => {
  if (artnetThrottler) {
    clearInterval(artnetThrottler);
    artnetThrottler = null;
  }
};

// IPC handlers for ArtNet
ipcMain.handle('initialize-artnet', async (event, options = {}) => {
  try {
    const { interfaceAddress } = options;
    if (!artnetInstance) {
      const dmxlib = await import('dmxnet');
      // dmxnet exports an object with a 'dmxnet' property which is the actual class
      const DMXnet = dmxlib.dmxnet || (dmxlib.default && dmxlib.default.dmxnet) || dmxlib.default || dmxlib;

      artnetInstance = new DMXnet({
        log: { level: 'error' },
        ip: interfaceAddress || undefined
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
      startArtnetThrottler();
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
    stopArtnetThrottler();
    artnetReceivers.clear();
    artnetUniverseBuffers.clear();
    artnetDirtyUniverses.clear();
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
      if (mainWindow) mainWindow.webContents.send('osc-message-received', { oscMessage });
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

ipcMain.handle('set-fft-settings', (event, fftSettings) => {
  store.set('fftSettings', fftSettings);
});

ipcMain.handle('set-selected-audio-input', (event, deviceId) => {
  store.set('selectedAudioInputDeviceId', deviceId);
});

ipcMain.handle('set-theme', (event, theme) => {
  store.set('theme', theme);
});

ipcMain.handle('set-dac-output-settings', (event, dacOutputSettings) => {
  store.set('dacOutputSettings', dacOutputSettings);
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

ipcMain.handle('get-dac-groups', () => {
  return store.get('dacGroups') || {};
});

ipcMain.handle('save-dac-groups', (event, groups) => {
  store.set('dacGroups', groups);
  return { success: true };
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

// Latest ILD directory listing per directory, so the renderer never waits on a
// fs.readdir round-trip again for the same folder (tab re-opens, re-mounts).
// TTL keeps it fresh if the user drops files into the folder while running.
const ildFileListCache = new Map(); // directoryPath -> { ts, files }
const ILD_LIST_TTL_MS = 10000;
let ildDefaultPath = null;

async function listIldFiles(directoryPath) {
  const cached = ildFileListCache.get(directoryPath);
  if (cached && Date.now() - cached.ts < ILD_LIST_TTL_MS) {
    return cached.files;
  }
  let files = [];
  try {
    const fullPath = path.isAbsolute(directoryPath) ? directoryPath : path.join(__dirname, directoryPath);
    const entries = await fs.promises.readdir(fullPath);
    files = entries.filter(f => f.toLowerCase().endsWith('.ild')).map(f => path.join(directoryPath, f));
  } catch (error) {
    files = [];
  }
  ildFileListCache.set(directoryPath, { ts: Date.now(), files });
  return files;
}

ipcMain.handle('get-user-ilda-path', async () => {
  if (!ildDefaultPath) ildDefaultPath = path.join(app.getPath('documents'), 'TrueLazer', 'ILDA-FILES');
  return ildDefaultPath;
});

// Single round-trip for the default directory's path + listing (LCP fast path).
ipcMain.handle('get-default-ild-files', async () => {
  if (!ildDefaultPath) ildDefaultPath = path.join(app.getPath('documents'), 'TrueLazer', 'ILDA-FILES');
  const files = await listIldFiles(ildDefaultPath);
  return { path: ildDefaultPath, files };
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
  if (mainWindow) mainWindow.webContents.send('new-project');
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
      const projectData = JSON.parse(data);

      // Portability: Restore embedded presets from project into local user presets
      if (projectData.projectPresets) {
        console.log("Presets: Restoring embedded presets from project...");
        for (const [type, subTypes] of Object.entries(projectData.projectPresets)) {
          for (const [subType, presets] of Object.entries(subTypes)) {
            const presetsPath = path.join(app.getPath('userData'), 'presets', type, subType);
            await fs.promises.mkdir(presetsPath, { recursive: true });
            for (const [name, preset] of Object.entries(presets)) {
              const fileName = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
              const filePath = path.join(presetsPath, fileName);
              await fs.promises.writeFile(filePath, JSON.stringify(preset, null, 2));
            }
          }
        }
      }

      if (mainWindow) mainWindow.webContents.send('load-project-data', projectData);
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
    if (mainWindow) mainWindow.webContents.send('save-project-as');
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
        { label: 'About', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'about'); } },
        { type: 'separator' },
        { label: 'Shape Builder', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'shapeBuilder'); } },
        { type: 'separator' },
        { label: 'Timeline Editor', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'timeline'); } },
        { type: 'separator' },
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => { if (mainWindow) mainWindow.webContents.send('new-project'); } },
        { label: 'Open Project', accelerator: 'CmdOrCtrl+O', click: () => { ipcMain.emit('open-project'); } },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => { if (mainWindow) mainWindow.webContents.send('save-project'); } },
        { label: 'Save Project As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => { if (mainWindow) mainWindow.webContents.send('save-project-as'); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { app.quit(); } },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'General Settings...', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'settings-general'); } },
        { label: 'Link/Sync Settings...', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'link-sync-settings'); } },
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
                      if (mainWindow) mainWindow.webContents.send('update-audio-device-id', device.deviceId);
                    }
                  })),
                  { type: 'separator' },
                  { label: 'Audio Output Settings...', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'settings-audio-output'); } }
                ]
                : [{ label: 'No devices found', enabled: false }]
            },
            { label: 'FFT Settings...', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'settings-audio-fft'); } }
          ]
        },
        { type: 'separator' },
        { label: 'Clear Thumbnail Cache', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clear-thumbnail-cache'); } }
      ],
    },
    {
      label: 'Layer',
      submenu: [
        { label: 'Rename', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'layer-rename'); } },
        { label: 'Clear Clips', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'layer-clear-clips'); } },
      ],
    },
    {
      label: 'Column',
      submenu: [
        { label: 'Duplicate', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'column-duplicate'); } },
        { label: 'Rename', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'column-rename'); } },
        { label: 'Clear Clips', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'column-clear-clips'); } },
      ],
    },
    {
      label: 'Clip',
      submenu: [
        { label: 'Trigger Style', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clip-trigger-style'); } },
        { label: 'Thumbnail', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clip-thumbnail'); } },
        { label: 'Cut', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clip-cut'); } },
        { label: 'Copy', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clip-copy'); } },
        { label: 'Paste', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clip-paste'); } },
        { label: 'Rename', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clip-rename'); } },
        { label: 'Clear', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'clip-clear'); } },
      ],
    },
    {
      label: 'Output',
      submenu: [
        { label: 'Open Output Settings', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'output-settings'); } },
        { label: 'Processing Settings...', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'output-processing'); } },
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
            if (mainWindow) mainWindow.webContents.send('menu-action', `toggle-midi-${shortcutsState.midi}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'MIDI Settings...',
          visible: shortcutsState.midi,
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'open-midi-settings'); }
        },
        { type: 'separator' },
        {
          label: 'ArtNet',
          type: 'checkbox',
          checked: shortcutsState.artnet,
          click: () => {
            shortcutsState.artnet = !shortcutsState.artnet;
            store.set('shortcutsState', shortcutsState);
            if (mainWindow) mainWindow.webContents.send('menu-action', `toggle-artnet-${shortcutsState.artnet}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'ArtNet Settings...',
          visible: shortcutsState.artnet,
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'open-artnet-settings'); }
        },
        { type: 'separator' },
        {
          label: 'OSC',
          type: 'checkbox',
          checked: shortcutsState.osc,
          click: () => {
            shortcutsState.osc = !shortcutsState.osc;
            store.set('shortcutsState', shortcutsState);
            if (mainWindow) mainWindow.webContents.send('menu-action', `toggle-osc-${shortcutsState.osc}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'OSC Settings...',
          visible: shortcutsState.osc,
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'open-osc-settings'); }
        },
        { type: 'separator' },
        {
          label: 'Keyboard',
          type: 'checkbox',
          checked: shortcutsState.keyboard,
          click: () => {
            shortcutsState.keyboard = !shortcutsState.keyboard;
            store.set('shortcutsState', shortcutsState);
            if (mainWindow) mainWindow.webContents.send('menu-action', `toggle-keyboard-${shortcutsState.keyboard}`);
            buildApplicationMenu(currentThumbnailRenderMode);
          }
        },
        {
          label: 'Keyboard Settings...',
          visible: shortcutsState.keyboard,
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'open-keyboard-settings'); }
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Predefined Layouts', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'view-layouts'); } },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'CommandOrControl+Shift+I', click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); } },
        {
          label: 'Color Theme',
          submenu: [
            { label: 'Orange', type: 'radio', checked: true, click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-orange'); } },
            { label: 'Yellow', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-yellow'); } },
            { label: 'Cyan', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-cyan'); } },
            { label: 'Light Blue', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-light-blue'); } },
            { label: 'Blue', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-blue'); } },
            { label: 'Magenta', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-magenta'); } },
            { label: 'Red', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-red'); } },
            { label: 'Green', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-green'); } },
            { label: 'White', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-theme-white'); } },
          ]
        },
        {
          label: 'Render Mode',
          submenu: [
            { label: 'Thumbnail Still Frame', type: 'radio', checked: mode === 'still', click: () => { sendThumbnailModeToRenderer('still'); } },
            { label: 'Thumbnail Live Render', type: 'radio', checked: mode === 'active', click: () => { sendThumbnailModeToRenderer('active'); } },
            { label: 'Thumbnail Hover Render', type: 'radio', checked: mode === 'hover', click: () => { sendThumbnailModeToRenderer('hover'); } },
            { type: 'separator' },
            { label: 'Show Beam Effect', type: 'checkbox', checked: true, click: (menuItem) => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'showBeamEffect', value: menuItem.checked }); } },
            { type: 'separator' },
            {
              label: 'Display Mode',
              submenu: [
                { label: 'Points', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'points' }); } },
                { label: 'Lines', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'lines' }); } },
                { label: 'Points & Lines', type: 'radio', checked: true, click: () => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamRenderMode', value: 'both' }); } },
              ]
            },
            { type: 'separator' },
            {
              label: 'Beam Alpha',
              submenu: [
                { label: '0.1', type: 'radio', checked: true, click: () => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.1 }); } },
                { label: '0.2', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.2 }); } },
                { label: '0.5', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.5 }); } },
                { label: '1.0', type: 'radio', click: () => { if (mainWindow) mainWindow.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 1.0 }); } },
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

let prolinkAutoStarted = false;
let stagelinqAutoStarted = false;

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

  if (isDev) {
    win.webContents.openDevTools();
  }

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
    stopDacSendLoop();
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

  // DAC frame store + send loop — the renderer pushes frames at 60fps via
  // dac-frame-update. We store only the latest frame per channel and send at
  // 30fps, sampling every other render frame without mixing animation states.
  let dacFrameAccumulator = {};
  let dacSendLoopTimer = null;
  let stoppedDacIps = new Set(); // DACs whose output was explicitly stopped (stale renderer frames are dropped)
  // Always-fed endpoints (Showbridge): fed a continuous 30fps datagram stream —
  // a real frame when the renderer has one, a dark idle frame otherwise — so the
  // SDK's DMA never goes quiet. Mirrors EtherDream/Truwave, whose continuous
  // blank/clear loop keeps DACs responsive the instant a clip becomes active.
  let dacTargets = [];
  const DAC_SEND_INTERVAL = 1000 / 30; // 30 fps per channel (Truwave default)
  const MAX_MISSED = 5; // ~167ms without a new frame before blanking
  const SILENT_TTL_MS = 3000; // feed laser-off blank/clear frames this long, then retire the channel

  ipcMain.on('dac-set-targets', (event, targets) => {
    dacTargets = Array.isArray(targets)
      ? targets.filter((t) => t && t.ip && t.channel != null).map((t) => ({ ip: t.ip, channel: t.channel, type: t.type || 'Showbridge' }))
      : [];
  });

  ipcMain.on('dac-frame-update', (event, frames) => {
    const now = Date.now();
    // Channels that were live but are missing from this update keep their entry
    // (with no new frame) so the send loop can feed them a proper laser-off
    // blank/clear packet — instead of deleting them on the spot, which starved
    // the DAC and made Showbridge cut output abruptly without a clean blank.
    // They are retired by the send loop after SILENT_TTL_MS of blanking.
    for (const id of Object.keys(dacFrameAccumulator)) {
      if (!frames[id]) {
        dacFrameAccumulator[id].frame = null;
      }
    }
    for (const id of Object.keys(frames)) {
      const f = frames[id];
      // Drop stale frames for DACs whose output has been stopped (e.g. the renderer
      // sent one last update during the world-output toggle-off window). If we
      // stored them, the send loop would re-open a wired that stop-dac-output+
      // stopSending() just blanked and closed — defeating the clean laser-off.
      if (stoppedDacIps.has(f.ip)) continue;
      if (!dacFrameAccumulator[id]) {
        dacFrameAccumulator[id] = { frame: null, sent: null, missed: 0, blanked: false, blank: null, lastActivity: now, ip: f.ip, channel: f.channel, type: f.type, options: f.options || {}, fps: f.fps || 30 };
      }
      dacFrameAccumulator[id].options = f.options || dacFrameAccumulator[id].options || {};
      if (f.fps) dacFrameAccumulator[id].fps = f.fps;
      dacFrameAccumulator[id].frame = f.points;
      dacFrameAccumulator[id].lastActivity = now;
    }
  });

  const startDacSendLoop = () => {
    if (dacSendLoopTimer) return;
    dacSendLoopTimer = setInterval(() => {
      const now = Date.now();
      const targetIds = new Set(dacTargets.map((t) => `${t.ip}:${t.channel}`));

      // Always-fed endpoints first: each tick sends a real frame when one is
      // waiting, else a dark idle frame so the Showbridge DMA is never starved.
      // This replaces the old "start sending once there is frame data" model —
      // the loop runs from laser-on and swaps the idle stream for the compiled
      // frame buffer the moment a clip is active.
      for (const t of dacTargets) {
        // Never reopen a DAC the user just stopped (laser-off window).
        if (stoppedDacIps.has(t.ip)) continue;
        const id = `${t.ip}:${t.channel}`;
        const acc = dacFrameAccumulator[id];
        if (acc && acc.frame) {
          acc.missed = 0;
          acc.blanked = false;
          acc.blank = null;
          acc.lastActivity = now;
          acc.sent = acc.frame;
          sendFrame(t.ip, t.channel, acc.frame, acc.fps || 30, t.type, acc.options);
          acc.frame = null;
        } else {
          sendIdleFrame(t.ip, t.channel, t.type, acc ? acc.options : undefined);
        }
      }

      for (const id of Object.keys(dacFrameAccumulator)) {
        // Target channels are fed above; don't double-handle them in the
        // legacy silence path (which would blank right after a real frame).
        if (targetIds.has(id)) continue;
        const acc = dacFrameAccumulator[id];
        if (!acc.frame) {
          acc.missed++;
          if (acc.missed >= MAX_MISSED) {
            // Sustained silence — keep a proper laser-off blank/clear frame flowing
            // every tick rather than sending it once and going silent. Showbridge
            // holds its output via a live datagram stream, so a single packet is
            // not enough to blank cleanly — repeated blanks prevent the abrupt cut.
            if (!acc.blanked) {
              const blank = new Float32Array(8);
              blank[6] = 1;
              acc.blank = blank;
              acc.blanked = true;
            }
            sendFrame(acc.ip, acc.channel, acc.blank, acc.fps || 30, acc.type, acc.options);
            // Retire the channel once it has been blanking for a while, so we don't
            // keep sending into the void to a DAC the app is no longer using.
            if (now - (acc.lastActivity || now) >= SILENT_TTL_MS) {
              delete dacFrameAccumulator[id];
            }
          } else if (acc.sent) {
            // Brief hiccup — repeat last known frame
            sendFrame(acc.ip, acc.channel, acc.sent, acc.fps || 30, acc.type, acc.options);
          }
          continue;
        }

        acc.missed = 0;
        acc.blanked = false;
        acc.blank = null;
        acc.lastActivity = now;
        acc.sent = acc.frame;
        sendFrame(acc.ip, acc.channel, acc.frame, acc.fps || 30, acc.type, acc.options);
        acc.frame = null;
      }
    }, DAC_SEND_INTERVAL);
  };

  const stopDacSendLoop = () => {
    if (dacSendLoopTimer) {
      clearInterval(dacSendLoopTimer);
      dacSendLoopTimer = null;
    }
  };

  ipcMain.on('start-dac-send-loop', startDacSendLoop);
  ipcMain.on('stop-dac-send-loop', stopDacSendLoop);

  ipcMain.handle('start-dac-output', async (event, ip, type) => {
    stoppedDacIps.delete(ip);
    dacCommunication.startOutput(ip, type);
  });

  ipcMain.handle('stop-dac-output', async (event, ip, type) => {
    // Mark this DAC as stopped so any stale dac-frame-update that is already in
    // flight from the renderer (an animate() tick that fired right at the toggle)
    // cannot recreate the accumulator entry behind our back and reopen the wires.
    stoppedDacIps.add(ip);
    // Remove this DAC's frames from the accumulator
    for (const id of Object.keys(dacFrameAccumulator)) {
      if (dacFrameAccumulator[id].ip === ip) {
        delete dacFrameAccumulator[id];
      }
    }
    stopSending(ip, type);
  });

  ipcMain.handle('get-network-interfaces', async () => {
    return getNetworkInterfaces();
  });

  ipcMain.on('show-layer-context-menu', (event, index) => {
    const layerContextMenu = Menu.buildFromTemplate([
      { label: 'Rename Layer', click: () => { if (mainWindow) mainWindow.webContents.send('context-menu-action', { type: 'rename-layer', index: index }); } },
    ]);
    layerContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-layer-full-context-menu', (event, layerIndex) => {
    const layerFullContextMenu = Menu.buildFromTemplate([
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
              if (mainWindow) mainWindow.webContents.send('layer-full-context-command', 'set-layer-thumbnail-mode-still', layerIndex);
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
              if (mainWindow) mainWindow.webContents.send('layer-full-context-command', 'set-layer-thumbnail-mode-active', layerIndex);
              buildApplicationMenu(currentThumbnailRenderMode);
            }
          }
        ]
      },
      { type: 'separator' },
      { label: 'Rename', click: () => { if (mainWindow) mainWindow.webContents.send('layer-full-context-command', 'layer-rename', layerIndex); } },
      { label: 'Clear Clips', click: () => { if (mainWindow) mainWindow.webContents.send('layer-full-context-command', 'layer-clear-clips', layerIndex); } },
    ]);
    layerFullContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-page-context-menu', (event, pageIndex) => {
    const pageContextMenu = Menu.buildFromTemplate([
      { label: 'Clear Clips', click: () => { if (mainWindow) mainWindow.webContents.send('page-context-command', 'page-clear-clips', pageIndex); } },
      { type: 'separator' },
      { label: 'Rename Page', click: () => { if (mainWindow) mainWindow.webContents.send('page-context-command', 'page-rename', pageIndex); } },
    ]);
    pageContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-column-context-menu', (event, index) => {
    const columnContextMenu = Menu.buildFromTemplate([
      { label: 'Duplicate', click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'column-duplicate'); } },
      { label: 'Rename Column', click: () => { if (mainWindow) mainWindow.webContents.send('context-menu-action', { type: 'rename-column', index: index }); } },
    ]);
    columnContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-clip-context-menu', (event, layerIndex, colIndex, currentTriggerStyle = 'normal') => {
    const clipContextMenu = Menu.buildFromTemplate([
      { label: 'Update Thumbnail', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'update-thumbnail', layerIndex, colIndex); } },
      { label: 'Export as ILDA', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'export-ilda', layerIndex, colIndex); } },
      { type: 'separator' },
      {
        label: 'Trigger Style',
        submenu: [
          { label: 'Normal', type: 'radio', checked: currentTriggerStyle === 'normal', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'set-trigger-style-normal', layerIndex, colIndex); } },
          { label: 'Toggle', type: 'radio', checked: currentTriggerStyle === 'toggle', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'set-trigger-style-toggle', layerIndex, colIndex); } },
          { label: 'Flash', type: 'radio', checked: currentTriggerStyle === 'flash', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'set-trigger-style-flash', layerIndex, colIndex); }, toolTip: '⚠ Flash clips run continuously in background. Use sparingly.' },
          { label: 'Temp', type: 'radio', checked: currentTriggerStyle === 'temp', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'set-trigger-style-temp', layerIndex, colIndex); } },
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
              if (mainWindow) mainWindow.webContents.send('clip-context-command', 'set-clip-thumbnail-mode-still', layerIndex, colIndex);
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
              if (mainWindow) mainWindow.webContents.send('clip-context-command', 'set-clip-thumbnail-mode-active', layerIndex, colIndex);
              buildApplicationMenu(currentThumbnailRenderMode);
            }
          }
        ]
      },
      { type: 'separator' },
      { label: 'Cut', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'cut-clip', layerIndex, colIndex); } },
      { label: 'Copy', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'copy-clip', layerIndex, colIndex); } },
      { label: 'Paste', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'paste-clip', layerIndex, colIndex); } },
      { type: 'separator' },
      { label: 'Rename', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'rename-clip', layerIndex, colIndex); } },
      { label: 'Clear', click: () => { if (mainWindow) mainWindow.webContents.send('clip-context-command', 'clear-clip', layerIndex, colIndex); } },
    ]);
    clipContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('show-column-header-clip-context-menu', (event, colIndex) => {
    const columnHeaderClipContextMenu = Menu.buildFromTemplate([
      { label: 'Update Thumbnail', click: () => { if (mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'update-thumbnail', colIndex }); } },
      { type: 'separator' },
      { label: 'Cut', click: () => { if (mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'cut-clip', colIndex }); } },
      { label: 'Copy', click: () => { if (mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'copy-clip', colIndex }); } },
      { label: 'Paste', click: () => { if (mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'paste-clip', colIndex }); } },
      { type: 'separator' },
      { label: 'Rename', click: () => { if (mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'rename-clip', colIndex }); } },
      { label: 'Clear', click: () => { if (mainWindow) mainWindow.webContents.send('column-header-clip-context-command', { command: 'clear-column-clips', colIndex }); } },
    ]);
    columnHeaderClipContextMenu.popup({ window: mainWindow });
  });

  ipcMain.on('set-audio-devices', (event, devices) => {
    audioDevices = devices;
    buildApplicationMenu(currentThumbnailRenderMode);
  });

  ipcMain.on('show-quick-assign-context-menu', (event, type, index, assignments = []) => {
    const menuItems = [];
    if (Array.isArray(assignments) && assignments.length > 0) {
      assignments.forEach((label, linkIndex) => {
        menuItems.push({
          label: `✕  ${label}`,
          click: () => { if (mainWindow) mainWindow.webContents.send('context-menu-action-from-main', { type: 'remove-quick-assign-link', controlType: type, index: index, linkIndex: linkIndex }); }
        });
      });
      menuItems.push({ type: 'separator' });
    }
    menuItems.push(
      { label: 'Reset Value', click: () => { if (mainWindow) mainWindow.webContents.send('context-menu-action-from-main', { type: 'reset-quick-assign', controlType: type, index: index }); } },
      { label: (assignments && assignments.length > 0) ? 'Clear All Assignments' : 'Clear Assignment', click: () => { if (mainWindow) mainWindow.webContents.send('context-menu-action-from-main', { type: 'clear-quick-assign', controlType: type, index: index }); } }
    );
    const quickAssignMenu = Menu.buildFromTemplate(menuItems);
    quickAssignMenu.popup({ window: mainWindow });
  });

  ipcMain.on('context-menu-action', (event, action) => {
    if (mainWindow) mainWindow.webContents.send('context-menu-action-from-main', action);
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
      return await listIldFiles(directoryPath);
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

  ipcMain.handle('get-file-stats', async (event, filePath) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
      const stats = await fs.promises.stat(fullPath);
      return { size: stats.size, mtime: stats.mtimeMs };
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('get-cached-thumbnail', async (event, cacheKey) => {
    try {
      const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails');
      const filePath = path.join(thumbnailsDir, cacheKey);
      const buffer = await fs.promises.readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('clear-thumbnail-cache', async () => {
    try {
      const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails');
      const files = await fs.promises.readdir(thumbnailsDir);
      await Promise.all(files.map(file => fs.promises.unlink(path.join(thumbnailsDir, file))));
      return { success: true, count: files.length };
    } catch (error) {
      return { success: false, error: error.message };
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

  ipcMain.handle('save-clip-file', async (event, content, defaultName = 'shape.clip') => {
    const userClipPath = path.join(app.getPath('documents'), 'TrueLazer', 'SHAPES');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save As Vector Clip',
      defaultPath: path.join(userClipPath, defaultName),
      filters: [{ name: 'TrueLazer Shape Clips', extensions: ['clip'] }]
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    try {
      await fs.promises.writeFile(filePath, content, 'utf8');
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

  // Timeline project files (Ctrl+S / Ctrl+O in the Timeline window)
  let currentTimelineProjectPath = null;
  ipcMain.handle('save-timeline-project', async (event, projectData, defaultName = null, forceDialog = false) => {
    // A saved/open project remembers its file: Ctrl+S then overwrites it
    // silently like any normal editor. A brand-new project (opened from the
    // timeline's local storage, never saved-as) falls through to the Save As
    // dialog automatically — never a null-path crash.
    if (!forceDialog && currentTimelineProjectPath) {
      try {
        await fs.promises.writeFile(currentTimelineProjectPath, JSON.stringify(projectData, null, 2), 'utf8');
        return { success: true, filePath: currentTimelineProjectPath };
      } catch (error) { return { success: false, error: error.message }; }
    }
    const name = (typeof defaultName === 'string' && defaultName.trim().length > 0)
      ? defaultName
      : 'timeline-project.json';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Timeline Project',
      defaultPath: path.join(app.getPath('documents'), 'TrueLazer', name),
      filters: [{ name: 'TrueLazer Timeline Project', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(projectData, null, 2), 'utf8');
      currentTimelineProjectPath = filePath;
      return { success: true, filePath };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('open-timeline-project', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Timeline Project',
      defaultPath: path.join(app.getPath('documents'), 'TrueLazer'),
      filters: [{ name: 'TrueLazer Timeline Project', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths.length) return null;
    try {
      const data = JSON.parse(await fs.promises.readFile(filePaths[0], 'utf8'));
      currentTimelineProjectPath = filePaths[0];
      return data;
    } catch (error) {
      return null;
    }
  });

  // Art-Net TimeCode (ArtTimeCode opcode 0x9700) listener. dmxnet already owns
  // UDP 6454 for DMX; a lone Art-Net TimeCode source is uncommon on that same
  // port, so this is best-effort: if the bind fails we log and continue.
  let artnetTcSocket = null;
  const startArtnetTimecodeListener = () => {
    if (artnetTcSocket) return;
    try {
      const dgram = require('dgram');
      artnetTcSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      artnetTcSocket.on('message', (msg) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (msg.length < 19) return;
        if (msg.toString('latin1', 0, 7) !== 'Art-Net') return;
        const opcode = msg.readUInt16LE(8);
        if (opcode !== 0x9700) return; // ArtTimeCode
        const frames = msg[14];
        const seconds = msg[15];
        const minutes = msg[16];
        const hours = msg[17];
        const type = msg[18];
        mainWindow.webContents.send('artnet-timecode', { hours, minutes, seconds, frames, type });
      });
      artnetTcSocket.bind(6454, () => {
        console.log('ArtNet TimeCode: listening on UDP 6454 (best-effort)');
      });
      artnetTcSocket.on('error', (err) => {
        console.warn('ArtNet TimeCode listener error:', err.message);
        artnetTcSocket = null;
      });
    } catch (e) {
      console.warn('ArtNet TimeCode listener unavailable:', e.message);
      artnetTcSocket = null;
    }
  };

  ipcMain.handle('start-artnet-timecode-listener', () => {
    startArtnetTimecodeListener();
    return { success: true };
  });
  ipcMain.on('stop-artnet-timecode-listener', () => {
    if (artnetTcSocket) {
      try { artnetTcSocket.close(); } catch (_) {}
      artnetTcSocket = null;
    }
  });

  // TCNet — TMB TCNet LINK Time Packet listener (UDP 60001 broadcast).
  // Mirrors the ArtNet TimeCode path so the Timeline Editor keeps its master/
  // slave semantics identical. Every master broadcasts a "Time Packet"
  // (Message Type 254) carrying both the layer-1 SMPTE timecode (BCD, for the
  // playhead) and per-layer 1-4 beat markers (for the BPM trigger-sync in
  // ShowControl). We only need to LISTEN — the timeline is always a slave.
  let tcnetTimeSocket = null;
  const startTcnetTimecodeListener = () => {
    if (tcnetTimeSocket) return;
    try {
      const dgram = require('dgram');
      // TcnetBpmTracker is a class from timecodeSync — reconstruct lazily so
      // the UDP listener stays isolated from the renderer's sync hook.
      const { TcnetBpmTracker } = require('./src/utils/timecodeSync.js');
      const bpmTracker = new TcnetBpmTracker();
      tcnetTimeSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      tcnetTimeSocket.on('message', (msg) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const { parseTcnetTimePacket, isTcnetTimePacket } = require('./src/utils/timecodeSync.js');
        if (!isTcnetTimePacket(msg)) return;
        const tc = parseTcnetTimePacket(msg);
        if (!tc) return;
        // Feed the beat tracker with the L1 beat marker so ShowControl can lock
        // its BPM trigger-sync to the TCNet grid (marker transitions → tempo).
        if (tc.beats && tc.beats.L1) bpmTracker.push({ beats: { L1: tc.beats.L1 }, timeMs: (tc.layerTimes && tc.layerTimes.L1) || 0 });
        const grid = bpmTracker.get();
        mainWindow.webContents.send('tcnet-timecode', {
          hours: tc.hours,
          minutes: tc.minutes,
          seconds: tc.seconds,
          frames: tc.frames,
          rate: tc.rate,
          beats: tc.beats || {},
          bpm: grid.bpm,
          beat: grid.beat,
          running: grid.running,
        });
      });
      tcnetTimeSocket.bind(60001, () => {
        console.log('TCNet: listening for Time Packet on UDP 60001');
        if (bpmTracker) bpmTracker.reset();
      });
      tcnetTimeSocket.on('error', (err) => {
        console.warn('TCNet Time Packet listener error:', err.message);
        tcnetTimeSocket = null;
      });
    } catch (e) {
      console.warn('TCNet Time Packet listener unavailable:', e.message);
      tcnetTimeSocket = null;
    }
  };

  ipcMain.handle('start-tcnet-timecode-listener', () => {
    startTcnetTimecodeListener();
    return { success: true };
  });
  ipcMain.on('stop-tcnet-timecode-listener', () => {
    if (tcnetTimeSocket) {
      try { tcnetTimeSocket.close(); } catch (_) {}
      tcnetTimeSocket = null;
    }
  });

  // PRO DJ LINK — prolink-connect CDJ deviceState listener. This bypasses
  // LinkBridge entirely: prolink-connect announces a virtual CDJ onto the
  // network, connects, and subscribes to every player's status stream
  // (`statusEmitter.status`). The live deck's state — `beatInMeasure` (1-4,
  // the same beat-marker cadence TCNet's L1 layer carries) — is fed through
  // the TcnetBpmTracker-style interval math and broadcast on the same
  // IPC/timecode bus as TCNet/ArtNet/MTC, on the `prolink-status` channel.
  let prolinkStarted = false;
  let prolinkNetwork = null;
  let prolinkTracker = null;
  let prolinkActiveDeviceId = null;
  const prolinkStatusLogged = new Set(); // deviceIds we've already logged a first status for
  // Serialized lifecycle queue: every start()/stop() request runs back-to-back,
  // so a stop issued while a start is still binding/autoconfiguring (which used
  // to leak the UDP sockets and poison port 50000) always runs after it, and a
  // start re-binds only after the previous stop's sockets have fully closed.
  let prolinkOp = Promise.resolve();
  const prolinkEnqueue = (op) => {
    const run = async () => {
      try { return await op(); }
      catch (err) { console.warn('Prolink: lifecycle error:', err && err.message); }
    };
    const p = prolinkOp.then(run);
    prolinkOp = p.catch(() => {});
    return p;
  };
  const prolinkDeviceStates = new Map();
  const PLAYING_PLAYSTATES = [3, 4]; // prolink CDJStatus.PlayState.Playing / Looping
  // Continuous beat-derived clock. Status packets only carry the integer beat
  // index, so snapping seconds to `beat * 60/bpm` sawtoothed the playhead
  // (0.47 s steps at 128 bpm). Instead we track the wall-clock instant each beat
  // is seen and ramp seconds 1:1 while beats keep flowing; when they stop the
  // ramp flatlines half a beat later, so pause parks near the true stop and a
  // jog/scrub that crosses beats still advances the timeline.
  let prolinkClock = { lastBeat: -1, lastBeatAt: 0 };

  // Raw Pro DJ Link packet decoding lives in src/utils/prodjBeats.js (unit
  // tested) — here we only keep the per-device latest packet state and the
  // analyzed beat grid cache for the followed deck.
  // Latest decoded packet per device: { beat: {at,nextBeatMs0}, abs: {at,playheadMs,trackLenSec} }
  const prolinkPackets = new Map();
  // First-decoded-packet diagnostics (one log per type per session so the
  // precision paths are plainly visible in the main log).
  let prolinkBeatPacketLogged = false;
  let prolinkAbsPacketLogged = false;
  const prolinkPosSourceLogged = { abs: false, grid: false };
  // Last absolute playhead per device, so "moving vs parked" can be detected
  // even when no beats are flowing (CDJ-3000 scratch / pause).
  const prolinkLastAbsMs = new Map();
  // Motion direction of the followed deck (+1 forward, -1 backward, seeded
  // forward). Only single-beat steps flip it — larger deltas are track
  // reloads / bar wraps, not reverse play. The grid/ramp fallbacks mirror
  // their ramps off this so backward playback and reverse scrubs walk the
  // timeline backward instead of sawtoothing between beat lines. The absolute
  // playhead path ignores this entirely (it is direction-exact).
  let prolinkDirection = 1;
  // Smoothed playback pitch (%) for the clock + reported BPM. The CDJ's
  // effectivePitch is slider-quantized and jitters a little; passing raw steps
  // into the grid ramp and the BPM readout makes the playhead twitch when the
  // slider moves. A short EMA over a few status packets kills the jitter but
  // still tracks a real tempo change within ~100-150 ms.
  let prolinkSmoothPitch = null;
  // Last transport state we smoothed against. The CDJ reports effectivePitch =
  // -100% while stopped, so pitch-scaling the analyzer BPM across a stop/start
  // drove the reported tempo down through zero (the UI then clamps it to its
  // 1 BPM floor) and back up again. Snapping the EMA on a transport transition
  // keeps the readout at the track's real tempo instead of ramping.
  let prolinkWasPlaying = false;
  // Which tempo estimate drives the position math right now ('eff' = pitch-
  // scaled analyzer BPM, 'grid' = measured beat cadence). Switching sources is
  // debounced so beat-to-beat tracker jitter can't flap it (flapping makes both
  // the BPM readout and the ramp deadband jump).
  let prolinkBpmSource = 'eff';
  let prolinkBpmSourceChangedAt = 0;
  // Devices that have proven they broadcast Pro DJ Link Absolute Position
  // packets (CDJ-3000+). Those decks hand us exact millisecond playheads, so
  // the analyzed beat-grid DB round-trip per track load is pure overhead — skip
  // it for them once proven.
  const prolinkAbsCapable = new Set();

  // Analyzed beat grid + duration for the followed deck's loaded track. Grid
  // entries are { offset: ms-at-0%-pitch, bpm, count-within-bar } per beat,
  // fetched once per track load via prolink-connect's db service.
  let prolinkGrid = null;
  let prolinkGridDurationMs = null;
  let prolinkTrackKey = null;
  let prolinkGridLoading = false;
  // Now-playing text for the middle-bar DJ-Link display. Populated by the same
  // db.getMetadata round-trip that fetches the beat grid, so no extra query.
  let prolinkTrackTitle = null;
  let prolinkTrackArtist = null;
  // Source colour per player. Pro DJ Link puts this in the CDJ "media slot"
  // announcement — the byte the player uses to tint its USB slot and that linked
  // players adopt in the top-left display, so an operator can see at a glance
  // which machine a track was loaded from. The byte indexes MediaColor:
  // 0 Default, 1 Pink, 2 Red, 3 Orange, 4 Yellow, 5 Green, 6 Aqua, 7 Blue,
  // 8 Purple. Only non-default colours are forwarded, so the UI keeps its own
  // default instead of claiming a colour nobody assigned.
  const PROLINK_MEDIA_COLORS = {
    1: '#ff8fb0', // Pink
    2: '#ff3b30', // Red
    3: '#ff9500', // Orange
    4: '#ffd60a', // Yellow
    5: '#32d74b', // Green
    6: '#40c8e0', // Aqua
    7: '#0a84ff', // Blue
    8: '#bf5af2', // Purple
  };
  const prolinkSourceColors = new Map(); // deviceId -> '#rrggbb'
  const prolinkSourceNames = new Map();  // deviceId -> mounted media name
  const prolinkMediaSlotLogged = new Set();

  const applyProlinkMediaSlot = (info) => {
    if (!info || info.deviceId == null) return;
    const hex = PROLINK_MEDIA_COLORS[info.color] || null;
    const prev = prolinkSourceColors.get(info.deviceId) || null;
    if (hex) prolinkSourceColors.set(info.deviceId, hex);
    if (info.name) prolinkSourceNames.set(info.deviceId, info.name);
    const logKey = `${info.deviceId}:${info.slot}:${info.color}`;
    if (!prolinkMediaSlotLogged.has(logKey)) {
      prolinkMediaSlotLogged.add(logKey);
      console.log(
        'Prolink: media slot', info.slot, 'on player', info.deviceId,
        '—', JSON.stringify(info.name || ''),
        'colour', info.color, hex ? `(${hex})` : '(default)'
      );
    }
    if (hex !== prev) broadcastProlinkStatus();
  };
  // Cover art per track, as a data URL. A miss is cached as null so a track with
  // no artwork is not re-queried on every load of the same file.
  const prolinkArtwork = new Map(); // trackKey -> dataUrl | null
  const prolinkArtworkPending = new Set();

  const sendDjLinkArtwork = (source, deviceId, trackKey, dataUrl) => {
    if (!dataUrl) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('djlink-artwork', { source, deviceId, trackKey, dataUrl });
  };

  // rekordbox artwork can come back as a raw Buffer or as a wrapped object
  // depending on whether it was resolved locally (pdb) or remotely.
  // rekordbox artwork comes back as a raw Buffer, so the mime type has to come
  // from the file extension recorded in the database rather than the payload.
  const prolinkArtworkToDataUrl = (art, fallbackMime) => {
    if (!art) return null;
    const buf = Buffer.isBuffer(art) ? art : (art.data || art.buffer || art.image);
    if (!buf || !buf.length) return null;
    const mime = (art.mimeType || art.contentType || fallbackMime || 'image/jpeg').toString();
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
  };

  const mimeFromArtworkPath = (p) => {
    const ext = String(p || '').split('.').pop().toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  };

  const queueProlinkArtworkFetch = (opts, trackKey, track) => {
    if (!prolinkNetwork || !prolinkNetwork.db) return;
    if (!track || !track.artwork || !track.artwork.path) return; // no artwork in the rekordbox db
    if (prolinkArtwork.has(trackKey) || prolinkArtworkPending.has(trackKey)) return;
    prolinkArtworkPending.add(trackKey);
    // getArtwork()'s local path takes the already-resolved track object (it
    // reads track.artwork.path) rather than a trackId, then pulls the image off
    // the player's media over NFS.
    Promise.resolve()
      .then(() => prolinkNetwork.db.getArtwork({ ...opts, track }))
      .then((art) => {
        prolinkArtworkPending.delete(trackKey);
        if (prolinkTrackKey !== trackKey) return; // deck moved on to another track
        const dataUrl = prolinkArtworkToDataUrl(art, mimeFromArtworkPath(track.artwork.path));
        prolinkArtwork.set(trackKey, dataUrl);
        if (dataUrl) {
          console.log('Prolink: cover art for track', opts.trackId, `(${Math.round(dataUrl.length / 1024)} KB data URL)`);
          sendDjLinkArtwork('prolink', opts.deviceId, trackKey, dataUrl);
        }
      })
      .catch((err) => {
        prolinkArtworkPending.delete(trackKey);
        prolinkArtwork.set(trackKey, null);
        console.log('Prolink: no cover art for track', opts.trackId, '-', err && err.message);
      });
  };

  // Fetch the analyzed beat grid + duration for a loaded track so the playhead
  // can anchor to true track milliseconds. Falls back to the beat-derived ramp
  // whenever the database strategy is unavailable (unanalyzed tracks, non-CDJ
  // sources), retrying only on the next track load.
  const queueProlinkGridFetch = (status) => {
    if (prolinkGridLoading) return;
    if (!prolinkNetwork || !prolinkNetwork.isConnected || !prolinkNetwork.isConnected()) return;
    if (!prolinkNetwork.db || !prolinkNetwork.statusEmitter) return;
    prolinkGridLoading = true;
    const trackKey = prolinkTrackKey;
    const opts = {
      deviceId: status.trackDeviceId || status.deviceId,
      trackType: status.trackType,
      trackSlot: status.trackSlot,
      trackId: status.trackId,
    };
    Promise.resolve()
      .then(() => prolinkNetwork.db.getMetadata(opts))
      .then((track) => {
        prolinkGridLoading = false;
        if (prolinkTrackKey !== trackKey) return;
        if (track) {
          // Now-playing text for the DJ-Link display. The pdb track row carries
          // `title` directly; the artist is only an `artistId` there, so accept
          // whichever artist shape this lookup path actually produced and leave
          // it null (placeholder in the UI) when it is only an id.
          prolinkTrackTitle = typeof track.title === 'string' ? track.title : null;
          const artist = track.artist;
          prolinkTrackArtist =
            typeof artist === 'string' ? artist
              : (artist && typeof artist.name === 'string') ? artist.name
                : (typeof track.artistName === 'string' ? track.artistName : null);
          if (!prolinkArtwork.has(trackKey)) queueProlinkArtworkFetch(opts, trackKey, track);
        }
        if (track && Array.isArray(track.beatGrid) && track.beatGrid.length > 0) {
          prolinkGrid = track.beatGrid;
          const grid = prolinkGrid;
          // prolink-connect reads the pdb Duration column raw — a 16-bit value
          // in SECONDS (a 5 min track reads back as 300). Convert to ms here so
          // it matches the grid offsets (ms) and the trackDuration payload.
          const pdbDurationMs =
            typeof track.duration === 'number' && track.duration > 0
              ? track.duration * 1000
              : null;
          // Grid-derived cross-check/fallback: last beat offset plus one beat
          // interval covers tails the analysis grid may not reach.
          const first = grid[0] ? grid[0].offset : null;
          const last = grid[grid.length - 1] ? grid[grid.length - 1].offset : null;
          const secondLast = grid[grid.length - 2] ? grid[grid.length - 2].offset : null;
          let durationMs = pdbDurationMs;
          if (last != null) {
            const gridEndMs =
              last +
              (secondLast != null && last > secondLast ? last - secondLast : 0);
            if (durationMs == null || gridEndMs > durationMs) durationMs = gridEndMs;
          }
          prolinkGridDurationMs = durationMs;
          console.log(
            'Prolink: loaded beat grid for track', status.trackId,
            `(${grid.length} beats, ${durationMs != null ? (durationMs / 1000).toFixed(1) : '?'}s, ` +
            `${first != null ? (first / 1000).toFixed(1) : 0}s → ${last != null ? (last / 1000).toFixed(1) : '?'}s)`
          );
        } else {
          console.warn('Prolink: no analyzed beat grid for track', status.trackId, '— sub-beat position falls back to tempo ramp');
        }
      })
      .catch((err) => {
        prolinkGridLoading = false;
        console.warn('Prolink: beat grid unavailable (sub-beat position falls back to tempo ramp):', err && err.message);
      });
  };

  // Best-guess default Pro DJ Link interface (first non-internal IPv4 adapter).
  // Passing a config into bringOnline() guarantees the network is never left
  // unconfigured — prolink-connect's disconnect() THROWS while unconfigured,
  // which leaked the bound sockets and caused EADDRINUSE on every restart.
  const pickDefaultNetworkIface = () => {
    try {
      const ifaces = require('os').networkInterfaces();
      for (const list of Object.values(ifaces)) {
        for (const iface of list || []) {
          if (iface && iface.family === 'IPv4' && !iface.internal && iface.address) {
            return { address: iface.address, netmask: iface.netmask, family: 'IPv4', mac: iface.mac, internal: false, cidr: iface.cidr };
          }
        }
      }
    } catch (_) {}
    return null;
  };

  const broadcastProlinkStatus = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('prolink-manager-status', {
      started: prolinkStarted,
      activeDeviceId: prolinkActiveDeviceId,
      deviceCount: prolinkDeviceStates.size,
      networkConnected: prolinkNetwork != null,
    });
  };

  // Coalesce the `prolink-status` IPC broadcast. CDJs broadcast status packets
  // continuously, and every packet would otherwise trigger renderer work (BPM
  // dispatch + timeline re-render). Latest-wins on a short timer, so a flood of
  // players collapses to ~30 Hz max instead of one IPC per UDP packet.
  let prolinkStatusTimer = null;
  let prolinkStatusLatest = null;
  const flushProlinkStatus = () => {
    prolinkStatusTimer = null;
    if (!prolinkStatusLatest) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const payload = prolinkStatusLatest;
    prolinkStatusLatest = null;
    mainWindow.webContents.send('prolink-status', payload);
  };
  const enqueueProlinkStatus = (payload) => {
    prolinkStatusLatest = payload;
    if (prolinkStatusTimer) return;
    prolinkStatusTimer = setTimeout(flushProlinkStatus, 33);
  };

  // Best-effort: identify which process holds a UDP port (Windows netstat + tasklist).
  const getPortOwner = (port) =>
    new Promise((resolve) => {
      execFile('netstat', ['-ano'], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        const line = String(stdout)
          .split(/\r?\n/)
          .find((l) => l.includes('UDP') && l.includes(`:${port}`) && l.includes('0.0.0.0'));
        if (!line) return resolve(null);
        const pid = line.trim().split(/\s+/).pop();
        if (!pid || !/^\d+$/.test(pid)) return resolve(null);
        execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err2, out2) => {
          if (err2) return resolve(String(pid));
          const m = String(out2).match(/"([^"]+)","(\d+)"/);
          resolve(m ? `${m[1]} (PID ${m[2]})` : String(pid));
        });
      });
    });

  // Try to bind a UDP port briefly; resolves true if it's currently free.
  const probePortFree = (port) =>
    new Promise((resolve) => {
      const sock = dgram.createSocket('udp4');
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        try { sock.close(); } catch {}
        resolve(ok);
      };
      sock.once('error', () => finish(false));
      sock.bind(port, '0.0.0.0', () => finish(true));
      setTimeout(() => finish(false), 1500);
    });

  // Pro DJ Link uses FIXED UDP ports 50000-50002. If any is already taken,
  // bringOnline() throws mid-bind and LEAKS the sockets it already opened —
  // which ties up 50000 forever. So verify the ports are free first and report
  // precisely instead of failing blind (the usual culprit is AnyDesk on 50001).
  const bindProlinkPorts = async (iface) => {
    const { bringOnline } = require('prolink-connect');
    const busy = [];
    for (const port of [50000, 50001, 50002]) {
      if (!(await probePortFree(port))) busy.push(port);
    }
    if (busy.length) {
      const detail = (
        await Promise.all(busy.map(async (p) => {
          const owner = await getPortOwner(p);
          return `${p} in use by ${owner || 'another program'}`;
        }))
      ).join(', ');
      throw new Error(
        `Pro DJ Link needs UDP ports 50000-50002, but ${detail}. Close that program ` +
        `(e.g. AnyDesk or Rekordbox) and try again.`
      );
    }
    return iface ? await bringOnline({ iface, vcdjId: 5 }) : await bringOnline();
  };

  const startProlinkStateListenerOp = async () => {
    if (prolinkStarted) {
      console.log('Prolink: start skipped — listener is already running');
      return;
    }
    prolinkStarted = true;
    console.log('Prolink: starting listener…');
    try {
      const { TcnetBpmTracker } = require('./src/utils/timecodeSync.js');
      prolinkTracker = new TcnetBpmTracker();

      // bringOnline() binds sockets on ports 50000/50001/50002 immediately.
      // Register the network right away so a stop() issued mid-autoconfig can
      // still disconnect it — otherwise those sockets leak and every later
      // start fails with "port 50000 already in use".
      const chosenIface = pickDefaultNetworkIface();
      console.log(`Prolink: verifying UDP ports 50000-50002 are free (iface ${chosenIface ? chosenIface.address : 'auto'})…`);
      const network = await bindProlinkPorts(chosenIface);
      prolinkNetwork = network;
      console.log('Prolink: UDP sockets bound');

      // autoconfigFromPeers() waits for a CDJ/Rekordbox announce to learn the
      // real interface. Bounded with a timeout so a missing peer fails cleanly
      // instead of hanging (and never reaching disconnect()).
      console.log('Prolink: waiting for a Pro DJ Link peer to auto-configure (10s timeout)…');
      // If a CDJ already announced between bind and autoconfig, its 'connected'
      // event may have fired before we attached a listener — skip the wait then.
      const autoconfig =
        network.deviceManager.devices.size > 0
          ? Promise.resolve()
          : network.autoconfigFromPeers();
      await Promise.race([
        autoconfig,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timed out waiting for a Pro DJ Link peer (CDJ or Rekordbox)')), 10000)
        ),
      ]);
      if (!network.isConfigured) {
        throw new Error('could not auto-configure the network (is Rekordbox running on this machine?)');
      }
      console.log('Prolink: peer found — network configured');
      network.connect();
      console.log('Prolink: network connected');
      if (!network.statusEmitter) {
        throw new Error('status service unavailable');
      }

      // The player sends this unprompted on the status port whenever a track is
      // loaded (measured on a CDJ-3000: the media-slot packet carrying the
      // assigned colour appears on a track change, NOT when the colour setting is
      // edited, and it is never sent in reply to a request — queryMediaSlot goes
      // unanswered on every port). So just listen.
      network.statusEmitter.on('mediaSlot', applyProlinkMediaSlot);

      // Decode the port-50001 packets prolink-connect otherwise discards, so
      // the clock can anchor to the CDJ's own beat timing / playhead. The
      // watcher hook is provided by a small patch to prolink-connect (see
      // lib/index.js bringOnline + watchBeatPackets) — without it, everything
      // keeps working on the status beat index alone.
      if (typeof network.watchBeatPackets === 'function') {
        console.log('Prolink: raw UDP-50001 packet watcher armed (patched prolink-connect)');
        network.watchBeatPackets((buf) => {
          const decoded = decodeProlinkPacket(buf);
          if (!decoded) return;
          if (decoded.kind === 'beat' && !prolinkBeatPacketLogged) {
            prolinkBeatPacketLogged = true;
            console.log(
              'Prolink: decoding beat packets — device', decoded.deviceId,
              `next beat ${decoded.nextBeatMs0}ms (0% pitch), ${decoded.bpm} bpm`
            );
          }
          if (decoded.kind === 'abs' && !prolinkAbsPacketLogged) {
            prolinkAbsPacketLogged = true;
            console.log('Prolink: absolute-position packets seen (CDJ-3000) — device', decoded.deviceId);
          }
          if (decoded.kind === 'abs') prolinkAbsCapable.add(decoded.deviceId);
          const entry = prolinkPackets.get(decoded.deviceId) || { beat: null, abs: null };
          const now = Date.now();
          if (decoded.kind === 'beat') {
            entry.beat = { at: now, nextBeatMs0: decoded.nextBeatMs0 };
          } else {
            entry.abs = { at: now, playheadMs: decoded.playheadMs, trackLenSec: decoded.trackLenSec };
          }
          prolinkPackets.set(decoded.deviceId, entry);
        });
      }

      // Pick the deck whose beat grid drives the show: prefer the master,
      // else the most recently reported live (playing / on-air) player.
      const pickActive = () => {
        const states = [...prolinkDeviceStates.values()];
        const master = states.find((s) => s.isMaster);
        if (master) return master;
        return (
          states
            .sort((a, b) => b.packetNum - a.packetNum)
            .find((s) => PLAYING_PLAYSTATES.includes(s.playState) || s.isOnAir) || null
        );
      };

      network.statusEmitter.on('status', (state) => {
        prolinkDeviceStates.set(state.deviceId, state);
        if (!prolinkStatusLogged.has(state.deviceId)) {
          prolinkStatusLogged.add(state.deviceId);
          console.log(
            'Prolink: first status packet from CDJ', state.deviceId,
            '— playState', state.playState,
            'trackBPM', state.trackBPM,
            'beatInMeasure', state.beatInMeasure
          );
        }
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const prevActiveId = prolinkActiveDeviceId;
        const active = pickActive();
        if (!active) return;
        // Switching decks mid-set starts a fresh beat grid — reset the
        // interval tracker and beat clock so old inter-beat intervals never
        // poison the BPM or the playhead ramp.
        if (prevActiveId !== null && prevActiveId !== active.deviceId) {
          prolinkTracker.reset();
          prolinkClock = { lastBeat: -1, lastBeatAt: 0 };
          prolinkDirection = 1;
          prolinkSmoothPitch = null;
          prolinkWasPlaying = false;
          prolinkBpmSource = 'eff';
          prolinkBpmSourceChangedAt = 0;
        }
        prolinkActiveDeviceId = active.deviceId;

        // Lightweight path: a status from a deck that is NOT the show clock
        // carries no timing — only the device map above needed refreshing. Skip
        // the playhead/BPM math for it; the active deck's own next event re-
        // derives everything. (If this event just made its deck the master,
        // active.deviceId === state.deviceId and we proceed.)
        if (state.deviceId !== active.deviceId) return;

        const playing = PLAYING_PLAYSTATES.includes(active.playState);
        const nowMs = Date.now();
        const rawPitch = active.effectivePitch || 0; // prolink-connect reports % (6 = +6%)
        // Snap on a transport transition rather than easing across it. A stop
        // reports -100% pitch and a start ramps it back to 0, so smoothing
        // through that would walk the reported BPM all the way to 1 and up
        // again — which also made every BPM-synced effect and preview recompute
        // its timing on the way, showing as jumping frames.
        if (playing !== prolinkWasPlaying) {
          prolinkWasPlaying = playing;
          prolinkSmoothPitch = rawPitch;
        }
        prolinkSmoothPitch =
          prolinkSmoothPitch == null
            ? rawPitch
            : prolinkSmoothPitch + (rawPitch - prolinkSmoothPitch) * 0.35;
        const pitchPct = prolinkSmoothPitch;
        const speed = 1 + pitchPct / 100; // track-ms consumed per real-ms
        // effectivePitch is a PERCENTAGE (+6% → 6.00) — scaling by (1 + pitch)
        // reported 3-7× the real BPM; it must be (1 + pitch/100).
        // Only scale it while the deck is actually rolling: stopped/paused there
        // is no playback rate to report, and the -100% stop pitch would otherwise
        // scale the analyzer BPM down to nothing. Paused/cued decks therefore
        // report the track's own tempo, which is what the CDJ's readout shows.
        const rollPitchPct = playing ? pitchPct : 0;
        const effectiveBpm =
          active.trackBPM && active.trackBPM > 0
            ? active.trackBPM * (1 + rollPitchPct / 100)
            : null;

        // TcnetBpmTracker-style beat math: beatInMeasure transitions (1→2→3→4)
        // are exact TCNet L1-style markers, so the same interval tracker locks
        // the real-time BPM from the CDJ's own beat cadence.
        let grid = { bpm: null, beat: 0, running: false };
        if (active.beatInMeasure > 0) {
          grid = prolinkTracker.push({ beats: { L1: active.beatInMeasure } });
        }

        // TEMPO — two estimates serve two jobs:
        //  reportedBpm is the pitch-scaled analyzer BPM rounded to one decimal,
        //    exactly what the CDJ's own readout shows (so our number matches the
        //    deck, and smoothing the pitch keeps it from jittering on the slider).
        //  physicalBpm is the tempo the POSITION math actually runs at. Prefer
        //    the measured beat cadence when it disagrees with the pitch-scaled
        //    value by >2% (deck-wide sync / Master Tempo / stale analysis),
        //    debounced so the tracker's beat-to-beat averaging can't flap it.
        const reportedBpm = effectiveBpm || grid.bpm;
        const wantGridBpm = !!(
          grid.bpm && (!effectiveBpm || Math.abs(grid.bpm - effectiveBpm) / effectiveBpm > 0.02)
        );
        const wantedSource = wantGridBpm ? 'grid' : 'eff';
        if (
          wantedSource !== prolinkBpmSource &&
          nowMs - prolinkBpmSourceChangedAt >= 1500
        ) {
          prolinkBpmSource = wantedSource;
          prolinkBpmSourceChangedAt = nowMs;
        }
        const physicalBpm =
          prolinkBpmSource === 'grid' ? grid.bpm : effectiveBpm || grid.bpm;

        // Sub-beat playhead: ramp seconds off the wall-clock instant each beat
        // was last seen so status updates don't snap the head to beat
        // boundaries. The ramp runs while beats keep arriving (playing,
        // cue-button playback, jog scrubs that cross beats) and flatlines half a
        // beat past the last beat once they stop, so pause parks within the
        // current beat and a jogwheel position change still moves the timeline.
        const secPerBeat = physicalBpm && physicalBpm > 0 ? 60 / physicalBpm : null;
        // If the measured tempo diverges from the pitch-scaled value (the same
        // >2% override above), run the grid ramp at the MEASURED tempo so the
        // playhead never drifts from the deck's real position; normally the
        // pitch math already is the physical rate and this is just `speed`.
        const adaptiveSpeed =
          physicalBpm && effectiveBpm && physicalBpm !== effectiveBpm
            ? speed * (physicalBpm / effectiveBpm)
            : speed;

        // Track identity → fetch the analyzed beat grid / duration once per load
        // so the playhead can anchor to true track milliseconds.
        const trackKey =
          active.trackId > 0
            ? `${active.deviceId}:${active.trackSlot}:${active.trackId}`
            : null;
        if (trackKey !== prolinkTrackKey) {
          prolinkTrackKey = trackKey;
          prolinkGrid = null;
          prolinkGridDurationMs = null;
          prolinkGridLoading = false;
          prolinkTrackTitle = null;
          prolinkTrackArtist = null;
          // Always fetch on a track change. It used to be skipped for decks that
          // send Absolute Position packets, since the grid was then redundant for
          // timing — but this same lookup is what supplies the now-playing title,
          // artist and cover art for the DJ-Link display, so it is needed even
          // when the position maths ignores the grid.
          if (trackKey) {
            queueProlinkGridFetch(active);
          }
        }

        if (active.beat != null && active.beat !== prolinkClock.lastBeat) {
          if (prolinkClock.lastBeat >= 0) {
            const delta = active.beat - prolinkClock.lastBeat;
            if (Math.abs(delta) === 1) prolinkDirection = delta < 0 ? -1 : 1;
          }
          prolinkClock.lastBeat = active.beat;
          prolinkClock.lastBeatAt = nowMs;
        }
        // "Beats flowing now" = a beat landed recently (within ~1.6 beats of the
        // current tempo). TcnetBpmTracker._running goes sticky after two beats
        // and never times out, so it can't gate the ramp — beat recency can.
        const beatElapsed =
          prolinkClock.lastBeat >= 0
            ? Math.max(0, (nowMs - prolinkClock.lastBeatAt) / 1000)
            : Number.POSITIVE_INFINITY;
        const beatsFlowing = secPerBeat
          ? beatElapsed <= Math.max(0.3, secPerBeat * 1.6)
          : false;

        // Precise playhead. Precedence:
        //  1. CDJ-3000+ absolute-position packet — exact ms, scrubbing included.
        //  2. Analyzed beat grid — anchor the last beat to its true track ms and
        //     interpolate to the next grid beat (pitch-scaled), preferring the
        //     CDJ's own next-beat countdown when a beat packet is fresh.
        //  3. Beat-derived ramp — previous fallback.
        const pkt = prolinkPackets.get(active.deviceId) || { beat: null, abs: null };
        const abs = pkt.abs && nowMs - pkt.abs.at < 1500 ? pkt.abs : null;
        const prevAbsMs = prolinkLastAbsMs.get(active.deviceId);
        const absMoving = !!abs && abs.playheadMs !== prevAbsMs && Math.abs(abs.playheadMs - (prevAbsMs ?? abs.playheadMs)) > 2;
        if (abs) prolinkLastAbsMs.set(active.deviceId, abs.playheadMs);

        const positionSource = abs ? 'abs' : prolinkGrid ? 'grid' : 'ramp';
        if (positionSource !== 'ramp' && !prolinkPosSourceLogged[positionSource]) {
          prolinkPosSourceLogged[positionSource] = true;
          console.log(
            'Prolink: playhead now anchored by', positionSource,
            `(device ${active.deviceId}, beat ${active.beat})`
          );
        }
        let seconds = null;
        if (abs) {
          seconds = abs.playheadMs / 1000;
        } else if (prolinkClock.lastBeat >= 0) {
          const gridIdx = prolinkClock.lastBeat - 1; // grid[0] is beat 1
          const hasGridBeat =
            prolinkGrid && gridIdx >= 0 && gridIdx < prolinkGrid.length && prolinkGrid[gridIdx];
          const backward = prolinkDirection < 0;
          if (hasGridBeat && secPerBeat) {
            const curOff = prolinkGrid[gridIdx].offset; // ms at 0% pitch
            if (backward && gridIdx === 0) {
              // Dead-zone at the very first beat — nothing further back to ramp.
              seconds = curOff / 1000;
            } else if (backward) {
              // Backward play: the head walks from the just-crossed beat line
              // back toward the previous grid beat, across that real-time
              // segment. Mirror the forward ramp so reverse playback and jog
              // scrubs glide backward instead of jumping to the next beat's
              // interval each time the counter steps down.
              const prev = prolinkGrid[gridIdx - 1];
              const prevOff = prev ? prev.offset : null;
              if (prevOff != null) {
                const intervalSec = (curOff - prevOff) / 1000 / adaptiveSpeed;
                const frac = beatsFlowing ? Math.min(beatElapsed / intervalSec, 1.2) : 0;
                seconds =
                  curOff / 1000 -
                  Math.max(0, intervalSec) * Math.min(Math.max(0, frac), 1);
              } else {
                const ramp = beatsFlowing ? beatElapsed : Math.min(beatElapsed, secPerBeat * 0.5);
                seconds = curOff / 1000 - ramp;
              }
            } else {
              const next = prolinkGrid[gridIdx + 1];
              const nextOff = next ? next.offset : null;
              if (nextOff != null) {
                // Real-time interval to the next grid beat, pitch-scaled. Prefer
                // the CDJ's own next-beat countdown (ms until next beat, at 0%
                // pitch) when a beat packet is fresh — that's the real device
                // timing instead of our interval math.
                const pktNextMs =
                  pkt.beat && nowMs - pkt.beat.at < 10000 ? pkt.beat.nextBeatMs0 : null;
                const intervalSec =
                  pktNextMs != null
                    ? pktNextMs / 1000 / adaptiveSpeed
                    : (nextOff - curOff) / 1000 / adaptiveSpeed;
                const frac = beatsFlowing ? Math.min(beatElapsed / intervalSec, 1.2) : 0;
                seconds =
                  curOff / 1000 +
                  Math.max(0, intervalSec) * Math.min(Math.max(0, frac), 1);
              } else {
                const ramp = beatsFlowing ? beatElapsed : Math.min(beatElapsed, secPerBeat * 0.5);
                seconds = curOff / 1000 + ramp;
              }
            }
          } else if (secPerBeat) {
            const ramp = beatsFlowing ? beatElapsed : Math.min(beatElapsed, secPerBeat * 0.5);
            seconds =
              backward && prolinkClock.lastBeat > 1
                ? prolinkClock.lastBeat * secPerBeat - ramp
                : prolinkClock.lastBeat * secPerBeat + ramp;
          }
        } else if (secPerBeat && Number.isFinite(active.beat) && active.beat > 0) {
          seconds = active.beat * secPerBeat;
        }
        const fps = 30;
        const totalSec = seconds == null ? 0 : Math.floor(seconds);
        const frames = seconds == null ? 0 : Math.floor((seconds % 1) * fps);

        enqueueProlinkStatus({
          deviceId: active.deviceId,
          playerId: active.deviceId,
          trackKey: prolinkTrackKey,
          trackTitle: prolinkTrackTitle,
          trackArtist: prolinkTrackArtist,
          // Assigned source colour for this player, already normalised to #rrggbb.
          deckColor: prolinkSourceColors.get(active.deviceId) || null,
          trackId: active.trackId,
          trackLoaded: active.trackId > 0,
          playState: active.playState,
          playing,
          isMaster: active.isMaster,
          isOnAir: active.isOnAir,
          isSync: active.isSync,
          isEmergencyMode: active.isEmergencyMode,
          trackBPM: active.trackBPM,
          sliderPitch: active.sliderPitch,
          effectivePitch: active.effectivePitch,
          effectiveBpm,
          beatInMeasure: active.beatInMeasure,
          beat: active.beat,
          beatsUntilCue: active.beatsUntilCue ?? null,
          packetNum: active.packetNum,
          seconds,
          timecode: {
            hours: Math.floor(totalSec / 3600),
            minutes: Math.floor((totalSec % 3600) / 60),
            seconds: totalSec % 60,
            frames,
          },
          rate: fps,
          bpm: reportedBpm != null ? Math.round(reportedBpm * 10) / 10 : null,
          beat: grid.beat,
          running: beatsFlowing || absMoving,
          positionSource,
          trackDuration: prolinkGridDurationMs,
        });
      });
      // Runtime error safety net: UDP sockets can emit unhandled errors
      // (e.g. network interface drops) which would otherwise crash the process.
      if (network.deviceManager) {
        network.deviceManager.on('error', (err) => {
          console.warn('Prolink: deviceManager error:', err && err.message);
        });
        const onDeviceChange = () => broadcastProlinkStatus();
        network.deviceManager.on('connect', (dev) => {
          console.log('Prolink: device connected —', dev && dev.name, `(id ${dev && dev.id})`, dev && dev.ip && dev.ip.address);
          onDeviceChange();
        });
        network.deviceManager.on('disconnect', (dev) => {
          console.log('Prolink: device disconnected —', dev && dev.name, `(id ${dev && dev.id})`);
          onDeviceChange();
        });
      }
      if (network.statusEmitter) {
        network.statusEmitter.on('error', (err) => {
          console.warn('Prolink: statusEmitter error:', err && err.message);
        });
      }
      console.log('Prolink: listening for CDJ deviceState (Pro DJ Link)');
      broadcastProlinkStatus();
    } catch (e) {
      const isAddrInUse = e && e.code === 'EADDRINUSE';
      if (isAddrInUse) {
        console.warn(
          'Prolink: port 50000 is already in use — another prolink-connect instance, ' +
          'Rekordbox, or a previous Pro DJ Link session may still be running. ' +
          'Stop the other process and retry.'
        );
      } else if (e && /timed out waiting for a Pro DJ Link peer/.test(e.message)) {
        console.warn(
          'Prolink: no Pro DJ Link peer (CDJ/Rekordbox) announced within 10s — listener stopped. ' +
          'Check the CDJ is on this subnet and exporting to Pro DJ Link.'
        );
      } else {
        console.warn('Prolink: listener unavailable:', e && e.message);
      }
      // Always release the UDP sockets on failure — skipping this previously
      // kept ports 50000-50002 bound and poisoned every later restart attempt.
      if (prolinkNetwork) {
        try {
          const p = prolinkNetwork.disconnect();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (err) {
          console.warn('Prolink: cleanup error:', err && err.message);
        }
      }
      prolinkNetwork = null;
      prolinkStarted = false;
      prolinkTracker = null;
      prolinkGrid = null;
      prolinkGridDurationMs = null;
      prolinkTrackKey = null;
      prolinkGridLoading = false;
      prolinkPackets.clear();
      prolinkLastAbsMs.clear();
      broadcastProlinkStatus();
    }
  };
  const startProlinkStateListener = () => prolinkEnqueue(startProlinkStateListenerOp);

  ipcMain.handle('start-prolink-state-listener', () => {
    console.log('Prolink: start IPC received');
    startProlinkStateListener();
    return { success: true };
  });
  const stopProlinkStateListenerOp = async () => {
    console.log('Prolink: stopping listener…');
    prolinkStarted = false;
    prolinkTracker = null;
    // Drop any in-flight coalesced status update.
    if (prolinkStatusTimer) {
      clearTimeout(prolinkStatusTimer);
      prolinkStatusTimer = null;
      prolinkStatusLatest = null;
    }
    if (prolinkNetwork) {
      let closing = null;
      try {
        const p = prolinkNetwork.disconnect();
        if (p && typeof p.catch === 'function') closing = p.catch(() => {});
      } catch (err) {
        console.warn('Prolink: stop error:', err && err.message);
      }
      prolinkNetwork = null;
      // Wait for the sockets (50000-50002) to actually close so the next
      // queued start() can bind without "port 50000 already in use".
      if (closing) await closing;
      console.log('Prolink: stopped — UDP sockets released');
    }
    prolinkDeviceStates.clear();
    prolinkActiveDeviceId = null;
    prolinkStatusLogged.clear();
    prolinkGrid = null;
    prolinkGridDurationMs = null;
    prolinkTrackKey = null;
    prolinkGridLoading = false;
    prolinkWasPlaying = false;
    prolinkPackets.clear();
    prolinkSourceColors.clear();
    prolinkSourceNames.clear();
    prolinkMediaSlotLogged.clear();
    prolinkLastAbsMs.clear();
    prolinkBeatPacketLogged = false;
    prolinkAbsPacketLogged = false;
    prolinkPosSourceLogged.abs = false;
    prolinkPosSourceLogged.grid = false;
    broadcastProlinkStatus();
  };
  ipcMain.on('stop-prolink-state-listener', () => {
    console.log('Prolink: stop IPC received');
    prolinkEnqueue(stopProlinkStateListenerOp);
  });

  // If the user left the listener "enabled" in settings, bring it back up on
  // launch so the UI's "Stop Listener" state matches the actual runtime state.
  if (!prolinkAutoStarted) {
    prolinkAutoStarted = true;
    const saved = store.get('prolinkSettings');
    if (saved && saved.enabled) {
      console.log('Prolink: auto-starting listener on launch (enabled=true in saved settings)');
      startProlinkStateListener();
    }
  }

  ipcMain.handle('get-prolink-settings', () => {
    return store.get('prolinkSettings') || { enabled: false, deviceId: '', selectedDevice: '', bpmSource: 'prolink' };
  });

  ipcMain.handle('set-prolink-settings', (event, settings) => {
    if (settings.enabled !== undefined) store.set('prolinkSettings.enabled', settings.enabled);
    if (settings.deviceId !== undefined) store.set('prolinkSettings.deviceId', settings.deviceId);
    if (settings.selectedDevice !== undefined) store.set('prolinkSettings.selectedDevice', settings.selectedDevice);
    if (settings.bpmSource !== undefined) store.set('prolinkSettings.bpmSource', settings.bpmSource);
    return { success: true };
  });

  ipcMain.handle('get-prolink-status', () => {
    return {
      started: prolinkStarted,
      activeDeviceId: prolinkActiveDeviceId,
      deviceCount: prolinkDeviceStates.size,
      networkConnected: prolinkNetwork != null,
    };
  });

  // ==========================================================================
  // STAGELINQ — Denon DJ StageLinq network listener (the DJ-Link alternative to
  // Pro DJ Link). Uses the `stagelinq` npm library (chrisle/StageLinq) to talk
  // to Denon players (SC5000/SC6000, Prime 4/2/Go, LC6000):
  //
  //   * StateMap service  -> per-deck transport + track state. TrueLazer
  //                         vendored patches subscribe SampleRate (samples->s)
  //                         and DeckIsMaster and forward both on PlayerStatus.
  //   * BeatInfo service  -> real-time beat stream. Each message carries the
  //                         deck's current beat (fractional, counts up), total
  //                         beats, BPM and the playhead's absolute position in
  //                         audio samples ("samples" — the scrolling-waveform
  //                         position). This is the Denon analogue of a CDJ-3000
  //                         Absolute Position packet: no beat grid needed.
  //
  //   Position precedence per active deck:
  //     1. samples / sampleRate (beats moving)  -> exact playhead in track sec.
  //     2. beat-ramp (bpm * Δbeats)             -> integration fallback when a
  //                                                device omits samples.
  //   The master deck is auto-picked: the deck with DeckIsMaster while playing,
  //   else the first playing deck, else a master deck, else the newest loaded.
  //
  //   The whole StageLinq database/album-art path is intentionally unavailable:
  //   `stagelinq` eagerly requires better-sqlite3-multiple-ciphers, which is
  //   NOT loadable under Electron's ABI. A vended stub replaces it (see
  //   node_modules/stagelinq/dist/sqlite-stub.js); downloadDbSources and
  //   enableFileTranfer stay false so the stub is never invoked.
  //
  //   VENDORED PATCHES — applied automatically. They live in
  //   patches/stagelinq+3.5.5.patch and are re-applied by `npm run patches`,
  //   which `postinstall` runs on every `npm install` / `npm ci`, so a normal
  //   install never leaves the library unpatched. If a patch is ever missing
  //   (e.g. an install with --ignore-scripts), verifyStagelinqPatches() below
  //   names the exact cause on startup instead of surfacing as an opaque
  //   "Failed to requestServices" timeout.
  //     1. network/NetworkDevice.js  — require better-sqlite3 -> ../sqlite-stub
  //     2. Databases/DbConnection.js — require better-sqlite3 -> ../sqlite-stub
  //     3. services/StateMap.js      — allowlist /Engine/Deck[1-4]/Track/SampleRate
  //     4. devices/Player.js         — forward SampleRate + DeckIsMaster
  //     5. network/announce.js       — DO NOT skip 169.254.x.x interfaces.
  //        Upstream drops link-local NICs when choosing broadcast targets, so on
  //        a direct-Ethernet rack (no DHCP, both ends 169.254.x.x) the Login
  //        announce never leaves this PC; the player still answers discovery,
  //        then RSTs our TCP connect and the log shows
  //        "Failed to requestServices". Including link-local targets fixes it.
  //   patches/prolink-connect+0.11.0.patch carries the Pro DJ Link
  //   watchBeatPackets patch under the same mechanism.
  // ==========================================================================
  let stagelinqStarted = false;
  let stagelinqClient = null;             // StageLinqInstance
  let stagelinqActiveDeckId = null;       // "<address>|<layer>" of the followed deck
  let stagelinqDirection = 1;             // +1 forward / -1 backward (from samples Δ)
  let stagelinqSmoothBpm = null;          // EMA over the deck's reported BPM
  let stagelinqOp = Promise.resolve();
  const stagelinqEnqueue = (op) => {
    const run = async () => {
      try {
        await op();
      } catch (err) {
        console.warn('StageLinq: lifecycle error:', err && err.message);
      }
    };
    const p = stagelinqOp.then(run);
    stagelinqOp = p.catch(() => {});
  };
  // Per-deck state keyed by "<address>|<layer>". Kept for the whole session so
  // deck switches never lose the follow target's playhead.
  const stagelinqDeckStates = new Map(); // key -> { address, layer, player, deck, playState, play, currentBpm, sampleRate, trackLength, title, artist, trackNetworkPath, songLoaded, deckIsMaster, masterStatus, masterTempo, seconds }
  const stagelinqSamples = new Map();    // key -> { samples, at } absolute playhead tracking
  const stagelinqBeats = new Map();      // key -> { beat, seconds, at } beat-ramp integration
  const stagelinqStatusLogged = new Set(); // deck keys we've logged a first status for
  const stagelinqPosSourceLogged = { samples: false, beat: false };
  const stageLinqDeckKey = (address, layer) => `${address}|${layer}`;
  const stageLinqDeckId = (d) => `${d.player}${d.layer}`; // matches PlayerStatus.deck
  // Embedded cover art per loaded track. Title/artist already arrive free on the
  // StateMap (/Track/SongName, /Track/ArtistName); only artwork needs the
  // FileTransfer service to read the file header. Cached per track so the header
  // is read once, not on every state packet.
  const stagelinqArtwork = new Map();   // "deviceId|networkPath" -> dataUrl | null
  const stagelinqArtworkPending = new Set();

  // Pulls embedded cover art out of the loaded file's header. `cachePath` is the
  // stable track identity used for caching; `filePath` is what FileTransfer's
  // stat call actually accepts — measured on a SC5000 (JP07), `trackNetworkPath`
  // stats as size 0 and silently yields no metadata, while `trackPathAbsolute`
  // (the /Engine Library/../... form the device reports) returns the real size.
  const fetchStagelinqArtwork = (deviceId, cachePath, filePath) => {
    if (!deviceId || !cachePath) return;
    if (!filePath) return;                       // nothing addressable to read
    if (cachePath.startsWith('streaming://')) return;
    const trackKey = `${deviceId}|${cachePath}`;
    if (stagelinqArtwork.has(trackKey) || stagelinqArtworkPending.has(trackKey)) return;
    stagelinqArtworkPending.add(trackKey);
    Promise.resolve()
      .then(() => {
        if (!stagelinqClient) return null;
        const entry = stagelinqClient.devices.devices.get(deviceId);
        const fileTransfer = entry && entry.fileTransferService;
        if (!fileTransfer) return null;
        const { extractMetadataFromDevice } = require('stagelinq');
        return extractMetadataFromDevice(fileTransfer, filePath);
      })
      .then((meta) => {
        stagelinqArtworkPending.delete(trackKey);
        if (!meta || !meta.artwork || !meta.artwork.length) {
          stagelinqArtwork.set(trackKey, null);
          return;
        }
        const mime = meta.artworkMimeType || 'image/jpeg';
        const dataUrl = `data:${mime};base64,${Buffer.from(meta.artwork).toString('base64')}`;
        stagelinqArtwork.set(trackKey, dataUrl);
        console.log('StageLinq: cover art for', cachePath.split('/').pop(), `(${Math.round(meta.artwork.length / 1024)} KB)`);
        sendDjLinkArtwork('stagelinq', deviceId, trackKey, dataUrl);
      })
      .catch((err) => {
        stagelinqArtworkPending.delete(trackKey);
        stagelinqArtwork.set(trackKey, null);
        console.log('StageLinq: no cover art for', cachePath.split('/').pop(), '-', err && err.message);
      });
  };

  // Manager status (settings-panel Connection row) broadcaster.
  const broadcastStagelinqStatus = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('stagelinq-manager-status', {
      started: stagelinqStarted,
      activeDeckId: stagelinqActiveDeckId,
      deckCount: stagelinqDeckStates.size,
      networkConnected: stagelinqClient != null,
    });
  };

  // Coalesce the `stagelinq-status` IPC broadcast (beats land at musical rate).
  let stagelinqStatusTimer = null;
  let stagelinqStatusLatest = null;
  const flushStagelinqStatus = () => {
    stagelinqStatusTimer = null;
    if (!stagelinqStatusLatest) return;
    const payload = stagelinqStatusLatest;
    stagelinqStatusLatest = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stagelinq-status', payload);
    }
  };
  const enqueueStagelinqStatus = (payload) => {
    stagelinqStatusLatest = payload;
    if (stagelinqStatusTimer) return;
    stagelinqStatusTimer = setTimeout(flushStagelinqStatus, 33);
  };

  // Pick the deck the show clock follows (the prolink pickActive equivalent).
  const pickStageLinqActive = () => {
    const decks = [...stagelinqDeckStates.values()].filter(
      (d) => d.songLoaded || d.trackNetworkPath
    );
    if (decks.length === 0) return null;
    const sel = stagelinqSettings.selectedDevice;
    if (sel) {
      const picked =
        decks.find((d) => stageLinqDeckId(d) === sel || stageLinqDeckKey(d.address, d.layer) === sel);
      if (picked) return picked;
    }
    const masterPlaying = decks.find((d) => d.deckIsMaster && d.playState);
    if (masterPlaying) return masterPlaying;
    const playing = decks.filter((d) => d.playState);
    if (playing.length > 0) return playing[0];
    const anyMaster = decks.find((d) => d.deckIsMaster);
    if (anyMaster) return anyMaster;
    return decks[0];
  };

  // StateMap -> PlayerStatus. Stores the deck and re-picks / re-emits the show
  // clock. Transport flips (play/pause) re-emit the frozen playhead so pause
  // stops advancing the timeline fast, before the beat watchdog times out.
  const handleStageLinqState = (status) => {
    if (!status || !status.address || !status.layer) return;
    const key = stageLinqDeckKey(status.address, status.layer);
    const prev = stagelinqDeckStates.get(key) || {};
    const deck = { ...prev, ...status, key };
    stagelinqDeckStates.set(key, deck);
    // New track on this deck -> pull its embedded cover once (cached by path).
    if (status.trackNetworkPath && status.trackNetworkPath !== prev.trackNetworkPath) {
      fetchStagelinqArtwork(status.deviceId, status.trackNetworkPath, status.trackPathAbsolute);
    }
    if (!stagelinqStatusLogged.has(key)) {
      stagelinqStatusLogged.add(key);
      console.log(
        'StageLinq: deck', stageLinqDeckId(deck),
        `(${deck.layer} @ ${deck.address})`,
        '— playState', !!deck.playState,
        'currentBpm', deck.currentBpm,
        'songLoaded', !!deck.songLoaded,
        'isMaster', !!deck.deckIsMaster
      );
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const prevActiveId = stagelinqActiveDeckId;
    const active = pickStageLinqActive();
    if (!active) return;
    if (prevActiveId !== null && prevActiveId !== active.key) {
      // New follow target — start a fresh BPM/phase baseline.
      stagelinqDirection = 1;
      stagelinqSmoothBpm = null;
      console.log('StageLinq: following deck', stageLinqDeckId(active), `(${active.key})`);
    }
    stagelinqActiveDeckId = active.key;
    // Lightweight path: non-active decks only need the map refresh above.
    if (key !== active.key) return;

    const playing = !!active.playState;
    // Default sample rate if the deck's SampleRate state hasn't landed yet.
    const sr = active.sampleRate || 44100;
    const nowMs = Date.now();
    let seconds = typeof active.seconds === 'number' ? active.seconds : null;
    const bp = active.currentBpm || null;
    if (bp && bp !== stagelinqSmoothBpm) {
      stagelinqSmoothBpm = stagelinqSmoothBpm == null ? bp : stagelinqSmoothBpm + (bp - stagelinqSmoothBpm) * 0.35;
    }
    const effectiveBpm = stagelinqSmoothBpm || bp;
    const reportedBpm = effectiveBpm != null ? Math.round(effectiveBpm * 10) / 10 : null;
    // Pause: flatline the playhead at the last known position.
    if (!playing) enqueueStageLinqReport(active, seconds, false, effectiveBpm, reportedBpm, sr, active.positionSource || 'beat');
  };

  // BeatInfo -> per-deck beat/sample stream. Only the active deck drives the
  // playhead; everything else just keeps its own beat/sample trackers fresh.
  const handleStageLinqBeat = (connInfo, data) => {
    if (!connInfo || !data || !Array.isArray(data.decks) || !mainWindow || mainWindow.isDestroyed()) return;
    const active = stagelinqDeckStates.get(stagelinqActiveDeckId);
    if (!active) return;
    for (let i = 0; i < data.decks.length; i++) {
      const layer = 'ABCD'[i];
      const key = stageLinqDeckKey(connInfo.address, layer);
      const dk = data.decks[i];
      if (!dk) continue;
      const nowMs = Date.now();
      // Snapshot the previous trackers BEFORE overwriting them. Reading an entry
      // back after writing the current value into it compares the value against
      // itself: the sample delta and dBeats both come out 0, so `running` stays
      // false forever and the renderer treats every update as a pause — gliding
      // the playhead toward the target instead of hard-seeking on a jump.
      const prevSmp = stagelinqSamples.get(key) || null;
      const prevBeat = stagelinqBeats.get(key) || null;
      // Fresh sample position — 0 on these devices means "not reported".
      if (typeof dk.samples === 'number' && dk.samples > 0) {
        stagelinqSamples.set(key, { samples: dk.samples, at: nowMs });
      }
      if (typeof dk.beat === 'number') {
        stagelinqBeats.set(key, { beat: dk.beat, at: nowMs, seconds: prevBeat ? prevBeat.seconds : null });
        const rec = stagelinqDeckStates.get(key);
        if (rec) {
          rec.beat = dk.beat;
          stagelinqDeckStates.set(key, rec);
        }
      }
      if (key !== stagelinqActiveDeckId) continue;

      // ----- ACTIVE DECK -> rebuild the show-clock playhead -----
      const deck = stagelinqDeckStates.get(key);
      const sr = deck.sampleRate || 44100;
      const bp = dk.bpm > 0 ? dk.bpm : deck.currentBpm;
      if (bp && bp !== stagelinqSmoothBpm) {
        stagelinqSmoothBpm = stagelinqSmoothBpm == null ? bp : stagelinqSmoothBpm + (bp - stagelinqSmoothBpm) * 0.35;
      }
      const effectiveBpm = stagelinqSmoothBpm || bp;
      const reportedBpm = effectiveBpm != null ? Math.round(effectiveBpm * 10) / 10 : null;

      let seconds = null;
      let running = false;
      let positionSource = 'ramp';
      const hasSamples = typeof dk.samples === 'number' && dk.samples > 0;
      if (hasSamples) {
        // Absolute playhead in samples (the "scrolling waveform" position).
        // The deck's own PlayState is the authoritative "is it rolling" signal
        // here: we already have an absolute position, so change detection is
        // unnecessary, and a beat jump / cue return has to register as a real
        // discontinuity so the renderer hard-seeks instead of gliding.
        if (prevSmp && typeof prevSmp.samples === 'number' && prevSmp.samples !== dk.samples) {
          stagelinqDirection = dk.samples > prevSmp.samples ? 1 : -1;
        }
        seconds = dk.samples / sr;
        running = !!deck.playState;
        positionSource = 'samples';
        if (!stagelinqPosSourceLogged.samples) {
          stagelinqPosSourceLogged.samples = true;
          console.log('StageLinq: playhead anchored by absolute sample position — device', connInfo.address, `@ ${sr} Hz`);
        }
      } else {
        // Beat-ramp integration fallback for devices that omit samples.
        const secPerBeat = bp && bp > 0 ? 60 / bp : null;
        if (secPerBeat && prevBeat && typeof prevBeat.seconds === 'number') {
          const dBeats = dk.beat - prevBeat.beat;
          if (Math.abs(dBeats) > 0) stagelinqDirection = dBeats < 0 ? -1 : 1;
          seconds = prevBeat.seconds + dBeats * secPerBeat;
          running = Math.abs(dBeats) > 1e-9 && !!deck.playState;
        } else if (secPerBeat && typeof dk.beat === 'number' && dk.beat > 0) {
          // No reliable origin yet — start integration at the current beat.
          seconds = 0;
        }
        positionSource = 'beat';
        if (!stagelinqPosSourceLogged.beat) {
          stagelinqPosSourceLogged.beat = true;
          console.log('StageLinq: no absolute sample position from device', connInfo.address, '— playhead uses beat-integration');
        }
        // Beat recency gate mirrors prolink's beats-flowing ramp: once beats
        // stop arriving (pause/cue park), flatline inside the current beat.
        const beatAt = prevBeat ? prevBeat.at : 0;
        const elapsed = nowMs - beatAt;
        running = running && secPerBeat ? elapsed <= Math.max(0.3, secPerBeat * 1.6) : false;
      }
      // Persist the frozen playhead so a later stateChanged (pause etc.) re-emits it.
      if (seconds != null && deck) {
        deck.seconds = seconds;
        deck.positionSource = positionSource;
        stagelinqDeckStates.set(key, deck);
        // Seed the beat-ramp anchor with the computed playhead so the next beat
        // integrates from here (not from a null anchor).
        const anchor = stagelinqBeats.get(key);
        if (anchor) stagelinqBeats.set(key, { beat: anchor.beat, at: anchor.at, seconds });
      }
      enqueueStageLinqReport(deck, seconds, running, effectiveBpm, reportedBpm, sr, positionSource);
    }
  };

  const enqueueStageLinqReport = (deck, seconds, running, effectiveBpm, reportedBpm, sampleRate, positionSource) => {
    if (!deck) return;
    const fps = 30;
    const totalSec = seconds == null ? 0 : Math.floor(seconds);
    const frames = seconds == null ? 0 : Math.floor((seconds % 1) * fps);
    enqueueStagelinqStatus({
      deviceId: deck.key,
      playerId: deck.deck || stageLinqDeckId(deck),
      trackKey: deck.trackNetworkPath ? `${deck.deviceId || ''}|${deck.trackNetworkPath}` : null,
      trackId: deck.trackNetworkPath || null,
      trackTitle: deck.title || null,
      trackArtist: deck.artist || null,
      // The deck's assigned colour, as the player reports it for its jog ring
      // ("#AARRGGBB"). Lets the UI label each player in the colour the operator
      // assigned to it, which is how the decks are told apart on the floor.
      deckColor: deck.jogColor || null,
      trackLoaded: !!(deck.songLoaded || deck.trackNetworkPath),
      playState: deck.playState ? 3 : 1,
      playing: !!deck.playState && running,
      isMaster: !!deck.deckIsMaster,
      isOnAir: false,
      isSync: false,
      isEmergencyMode: false,
      trackBPM: deck.currentBpm || effectiveBpm || null,
      sliderPitch: null,
      effectivePitch: null,
      effectiveBpm: effectiveBpm != null ? Math.round(effectiveBpm * 10) / 10 : null,
      beatInMeasure: 0,
      beat: typeof deck.beat === 'number' ? Math.floor(deck.beat) : 0,
      beatsUntilCue: null,
      packetNum: 0,
      seconds,
      timecode: {
        hours: Math.floor(totalSec / 3600),
        minutes: Math.floor((totalSec % 3600) / 60),
        seconds: totalSec % 60,
        frames,
      },
      rate: fps,
      bpm: reportedBpm,
      running: !!running,
      positionSource,
      // Denon reports TrackLength in SAMPLES, not milliseconds (a 4:22 track at
      // 44.1 kHz reads back as 11574144). Convert with the deck's own sample rate
      // so this payload is milliseconds like the ProDJ one — otherwise a consumer
      // that assumes ms renders the duration as 3:12:54 instead of 4:22.
      trackDuration: deck.trackLength && sampleRate
        ? (deck.trackLength / sampleRate) * 1000
        : null,
      sampleRate,
    });
  };

  // The library is patched in place (see patches/stagelinq+3.5.5.patch, applied
  // by `npm run patches` on every install). If that ever got skipped -- e.g.
  // `npm ci --ignore-scripts` -- the failure modes are opaque: the unpatched
  // sqlite require throws an ABI error, and the unpatched announce drops
  // link-local NICs so a direct-Ethernet player RSTs the TCP connect and the
  // log only ever says "Failed to requestServices". Name the real cause here.
  const verifyStagelinqPatches = () => {
    const problems = [];
    let pkgDir = null;
    try {
      pkgDir = path.dirname(require.resolve('stagelinq/package.json'));
    } catch (e) {
      problems.push('the `stagelinq` package is not installed');
      return problems;
    }
    if (!fs.existsSync(path.join(pkgDir, 'dist', 'sqlite-stub.js'))) {
      problems.push('dist/sqlite-stub.js is missing (better-sqlite3 ABI patch)');
    }
    try {
      const announce = fs.readFileSync(path.join(pkgDir, 'dist', 'network', 'announce.js'), 'utf8');
      if (announce.includes("startsWith('169.254.')")) {
        problems.push('dist/network/announce.js still skips 169.254.x.x interfaces (link-local Login announce patch)');
      }
    } catch (e) {
      problems.push('dist/network/announce.js could not be read');
    }
    try {
      const stateMap = fs.readFileSync(path.join(pkgDir, 'dist', 'services', 'StateMap.js'), 'utf8');
      if (!/EngineDeck[1-4]TrackSampleRate/.test(stateMap)) {
        problems.push('dist/services/StateMap.js is missing the SampleRate allowlist entries');
      }
    } catch (e) {
      problems.push('dist/services/StateMap.js could not be read');
    }
    return problems;
  };

  const startStagelinqListenerOp = async () => {
    if (stagelinqStarted) {
      console.log('StageLinq: start skipped — listener is already running');
      return;
    }
    const patchProblems = verifyStagelinqPatches();
    if (patchProblems.length > 0) {
      console.error('StageLinq: the installed library is missing TrueLazer patches:');
      for (const p of patchProblems) console.error('  - ' + p);
      console.error('StageLinq: run `npm run patches` (or a normal `npm install`) to re-apply patches/stagelinq+3.5.5.patch');
    }
    stagelinqStarted = true;
    console.log('StageLinq: starting listener (UDP 51337 discovery)…');
    try {
      const { StageLinqInstance } = require('stagelinq');
      // Database download needs better-sqlite3-multiple-ciphers, which cannot load
      // under Electron's ABI — the vended sqlite-stub throws only if that disabled
      // path is ever touched. File Transfer is left ON: it is a separate service
      // that needs no native module, and TrueLazer uses it to read the embedded
      // cover art out of the loaded file's header.
      const slLogger = {
        trace: () => {}, debug: () => {}, info: (...a) => console.log('StageLinq:', ...a),
        warn: (...a) => console.warn('StageLinq:', ...a), error: (...a) => console.error('StageLinq:', ...a),
      };
      const client = new StageLinqInstance({
        downloadDbSources: false,
        enableFileTranfer: true,
        maxRetries: 2,
        logger: slLogger,
      });
      const devices = client.devices;
      devices.on('connected', (info) => {
        console.log('StageLinq: device connected —', info && info.source, '@', info && info.address, ':', info && info.port);
        broadcastStagelinqStatus();
      });
      devices.on('ready', () => {
        console.log('StageLinq: devices ready');
        broadcastStagelinqStatus();
      });
      devices.on('stateChanged', handleStageLinqState);
      devices.on('beatMessage', handleStageLinqBeat);
      devices.on('error', (err) => {
        console.warn('StageLinq: device error:', err && err.message);
      });
      stagelinqClient = client;
      await client.connect();
      console.log('StageLinq: listening for Denon players (StateMap + BeatInfo)');
      broadcastStagelinqStatus();
    } catch (e) {
      console.warn('StageLinq: listener unavailable:', e && e.message);
      if (stagelinqClient) {
        try {
          await stagelinqClient.disconnect();
        } catch (err) {
          console.warn('StageLinq: cleanup error:', err && err.message);
        }
      }
      stagelinqClient = null;
      stagelinqStarted = false;
      stagelinqDeckStates.clear();
      stagelinqActiveDeckId = null;
      stagelinqSamples.clear();
      stagelinqBeats.clear();
      stagelinqDirection = 1;
      stagelinqSmoothBpm = null;
      broadcastStagelinqStatus();
    }
  };
  const startStagelinqListener = () => stagelinqEnqueue(startStagelinqListenerOp);

  ipcMain.handle('start-stagelinq-listener', () => {
    console.log('StageLinq: start IPC received');
    startStagelinqListener();
    return { success: true };
  });
  const stopStagelinqListenerOp = async () => {
    console.log('StageLinq: stopping listener…');
    stagelinqStarted = false;
    if (stagelinqStatusTimer) {
      clearTimeout(stagelinqStatusTimer);
      stagelinqStatusTimer = null;
      stagelinqStatusLatest = null;
    }
    if (stagelinqClient) {
      try {
        await stagelinqClient.disconnect();
      } catch (err) {
        console.warn('StageLinq: stop error:', err && err.message);
      }
      stagelinqClient = null;
      console.log('StageLinq: stopped — UDP/TCP sockets released');
    }
    stagelinqDeckStates.clear();
    stagelinqActiveDeckId = null;
    stagelinqSamples.clear();
    stagelinqBeats.clear();
    stagelinqDirection = 1;
    stagelinqSmoothBpm = null;
    stagelinqStatusLogged.clear();
    stagelinqArtwork.clear();
    stagelinqArtworkPending.clear();
    stagelinqPosSourceLogged.samples = false;
    stagelinqPosSourceLogged.beat = false;
    broadcastStagelinqStatus();
  };
  ipcMain.on('stop-stagelinq-listener', () => {
    console.log('StageLinq: stop IPC received');
    stagelinqEnqueue(stopStagelinqListenerOp);
  });

  // Restore the listener if the user left it enabled in settings.
  if (!stagelinqAutoStarted) {
    stagelinqAutoStarted = true;
    const saved = store.get('stagelinqSettings');
    if (saved && saved.enabled) {
      console.log('StageLinq: auto-starting listener on launch (enabled=true in saved settings)');
      startStagelinqListener();
    }
  }

  ipcMain.handle('get-stagelinq-settings', () => {
    return store.get('stagelinqSettings') || { enabled: false, deviceId: '', selectedDevice: '', bpmSource: 'stagelinq' };
  });

  ipcMain.handle('set-stagelinq-settings', (event, settings) => {
    if (settings.enabled !== undefined) store.set('stagelinqSettings.enabled', settings.enabled);
    if (settings.deviceId !== undefined) store.set('stagelinqSettings.deviceId', settings.deviceId);
    if (settings.selectedDevice !== undefined) store.set('stagelinqSettings.selectedDevice', settings.selectedDevice);
    if (settings.bpmSource !== undefined) store.set('stagelinqSettings.bpmSource', settings.bpmSource);
    return { success: true };
  });

  ipcMain.handle('get-stagelinq-status', () => {
    return {
      started: stagelinqStarted,
      activeDeckId: stagelinqActiveDeckId,
      deckCount: stagelinqDeckStates.size,
      networkConnected: stagelinqClient != null,
    };
  });

  // Cover art is pushed once per track, ~130ms after the track is first seen. A
  // renderer that mounts (or reloads) after that push never receives it, so it
  // would sit on the placeholder forever. This lets the renderer pull whatever
  // has already been fetched, keyed exactly as the push channel keys it.
  ipcMain.handle('get-djlink-artwork', () => {
    const all = {};
    for (const [key, dataUrl] of stagelinqArtwork) {
      if (dataUrl) all[`stagelinq|${key}`] = dataUrl;
    }
    for (const [key, dataUrl] of prolinkArtwork) {
      if (dataUrl) all[`prolink|${key}`] = dataUrl;
    }
    return all;
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

  ipcMain.handle('get-presets', async (event, type, subType) => {
    try {
      // type: 'effect' or 'generator', subType: 'color', 'circle', etc.
      const presetsPath = path.join(app.getPath('userData'), 'presets', type, subType);
      await fs.promises.mkdir(presetsPath, { recursive: true });
      const files = await fs.promises.readdir(presetsPath);
      const presets = await Promise.all(files.filter(f => f.endsWith('.json')).map(async (file) => {
        const content = await fs.promises.readFile(path.join(presetsPath, file), 'utf8');
        return JSON.parse(content);
      }));
      return presets;
    } catch (error) {
      console.error('Error getting presets:', error);
      return [];
    }
  });

  ipcMain.handle('save-preset', async (event, type, subType, preset) => {
    try {
      const presetsPath = path.join(app.getPath('userData'), 'presets', type, subType);
      await fs.promises.mkdir(presetsPath, { recursive: true });
      const fileName = `${preset.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
      const filePath = path.join(presetsPath, fileName);
      await fs.promises.writeFile(filePath, JSON.stringify(preset, null, 2));
      return { success: true, filePath };
    } catch (error) {
      console.error('Error saving preset:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-preset', async (event, type, subType, presetName) => {
    try {
      const fileName = `${presetName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
      const filePath = path.join(app.getPath('userData'), 'presets', type, subType, fileName);
      await fs.promises.unlink(filePath);
      return { success: true };
    } catch (error) {
      console.error('Error deleting preset:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-desktop-audio-source-id', async () => {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    // Usually the first screen is what we want for system audio
    return sources.length > 0 ? sources[0].id : null;
  });

  // Background System Stats Loop
  // pidusage and ps-tree both spawn `wmic.exe` on Windows. On machines where
  // WMIC has been removed (compact/newer Windows builds) those spawns emit an
  // asynchronous ENOENT error: ps-tree attaches no 'error' listener, and
  // pidusage's availability probe throws from a callback its try/catch cannot
  // catch — either can surface as an "Uncaught Exception: Error Spawn
  // wmic.exe ENOENT" right after startup. Probe once and pick a wmic-free path.
  let wmicAvailable = process.platform !== 'win32' ? true : null; // null = probe pending
  const checkWmic = async () => {
    if (wmicAvailable === null) {
      wmicAvailable = await new Promise(resolve => {
        execFile('where', ['wmic.exe'], { windowsHide: true }, err => resolve(!err));
      });
      if (!wmicAvailable) console.warn('WMIC not found; using fallback for system stats.');
    }
    return wmicAvailable;
  };

  const collectSystemStats = (pids, wmicOk) => {
    const collect = (stats) => {
      if (!stats) return;
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
    };
    const onError = (e) => console.warn('Error collecting system stats:', e && e.message ? e.message : e);

    if (wmicOk) {
      pidusage(pids, (err, stats) => {
        if (err || !stats) return onError(err);
        collect(stats);
      });
    } else {
      // wmic is missing: use pidusage's bundled gwmi (PowerShell) backend,
      // which never spawns wmic.
      try {
        const gwmi = require('pidusage/lib/gwmi');
        gwmi(pids, { maxage: 60000 }, (err, stats) => err ? onError(err) : collect(stats));
      } catch (e) {
        onError(e);
      }
    }
  };

  let mainCpuLast = null;
  let mainCpuLastTime = 0;
  const sendSystemStats = async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const wmicOk = await checkWmic();
      if (wmicOk) {
        psTree(process.pid, (err, children) => {
          const pids = [process.pid, ...(err ? [] : children.map(p => parseInt(p.PID)).filter(pid => !isNaN(pid)))];
          collectSystemStats(pids, true);
        });
      } else {
        // Cannot enumerate the process tree without wmic; measure the main
        // process directly (no external spawn, guaranteed to work).
        const now = Date.now();
        const usage = process.cpuUsage();
        let cpu = 0;
        if (mainCpuLast) {
          const dtMs = Math.max(1, now - mainCpuLastTime);
          const usedMs = (usage.user - mainCpuLast.user + usage.system - mainCpuLast.system) / 1000;
          cpu = Math.min(100, (usedMs / dtMs) * 100);
        }
        mainCpuLast = usage;
        mainCpuLastTime = now;
        const ramMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(0);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('system-stats', { cpu: cpu.toFixed(1), ram: ramMB });
        }
      }
    } catch (e) {
      console.error("Error in system stats:", e);
    }
  };
  setInterval(sendSystemStats, 4000);

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
  startFileLog();
  console.log(`[Init] App started (v${app.getVersion()}) on ${os.platform()}-${os.arch()}`);
  // Web MIDI in Electron is gated behind a main-process permission grant. Without
  // these handlers, navigator.requestMIDIAccess() (awaited by webmidi's
  // WebMidi.enable()) never resolves and the renderer stays on "Initializing
  // MIDI...". Grant midi/midiSysex explicitly and keep Electron's default
  // allow-everything behavior for all other permissions (e.g. media so the
  // audio visualizer's getUserMedia() still works).
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

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
