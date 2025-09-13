const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173'); // Vite development server default port
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '..\dist', 'index.html'));
  }

  const menuTemplate = [
    {
      label: 'TrueLazer',
      submenu: [
        { label: 'About', click: () => { win.webContents.send('menu-action', 'about'); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { app.quit(); } },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'General', click: () => { win.webContents.send('menu-action', 'settings-general'); } },
      ],
    },
    {
      label: 'Layer',
      submenu: [
        { label: 'New', click: () => { win.webContents.send('menu-action', 'layer-new'); } },
        { label: 'Insert Above', click: () => { win.webContents.send('menu-action', 'layer-insert-above'); } },
        { label: 'Insert Below', click: () => { win.webContents.send('menu-action', 'layer-insert-below'); } },
        { label: 'Rename', click: () => { win.webContents.send('menu-action', 'layer-rename'); } },
        { label: 'Clear Clips', click: () => { win.webContents.send('menu-action', 'layer-clear-clips'); } },
        { label: 'Delete', click: () => { win.webContents.send('menu-action', 'layer-delete'); } },
      ],
    },
    {
      label: 'Column',
      submenu: [
        { label: 'New', click: () => { win.webContents.send('menu-action', 'column-new'); } },
        { label: 'Insert Before', click: () => { win.webContents.send('menu-action', 'column-insert-before'); } },
        { label: 'Insert After', click: () => { win.webContents.send('menu-action', 'column-insert-after'); } },
        { label: 'Duplicate', click: () => { win.webContents.send('menu-action', 'column-duplicate'); } },
        { label: 'Rename', click: () => { win.webContents.send('menu-action', 'column-rename'); } },
        { label: 'Clear Clips', click: () => { win.webContents.send('menu-action', 'column-clear-clips'); } },
        { label: 'Remove', click: () => { win.webContents.send('menu-action', 'column-remove'); } },
      ],
    },
    {
      label: 'Clip',
      submenu: [
        { label: 'Trigger Style', click: () => { win.webContents.send('menu-action', 'clip-trigger-style'); } },
        { label: 'Thumbnail', click: () => { win.webContents.send('menu-action', 'clip-thumbnail'); } },
        { label: 'Cut', click: () => { win.webContents.send('menu-action', 'clip-cut'); } },
        { label: 'Copy', click: () => { win.webContents.send('menu-action', 'clip-copy'); } },
        { label: 'Paste', click: () => { win.webContents.send('menu-action', 'clip-paste'); } },
        { label: 'Rename', click: () => { win.webContents.send('menu-action', 'clip-rename'); } },
        { label: 'Clear', click: () => { win.webContents.send('menu-action', 'clip-clear'); } },
      ],
    },
    {
      label: 'Output',
      submenu: [
        { label: 'Open Output Settings', click: () => { win.webContents.send('menu-action', 'output-settings'); } },
      ],
    },
    {
      label: 'Shortcuts',
      submenu: [
        { label: 'Open Shortcuts Window', click: () => { win.webContents.send('menu-action', 'shortcuts-window'); } },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Predefined Layouts', click: () => { win.webContents.send('menu-action', 'view-layouts'); } },
        { label: 'Color Theme', click: () => { win.webContents.send('menu-action', 'view-color-theme'); } },
        {
          label: 'Render Mode',
          submenu: [
            { label: 'Show Beam Effect', type: 'checkbox', checked: true, click: (menuItem) => { win.webContents.send('render-settings-command', { setting: 'showBeamEffect', value: menuItem.checked }); } },
            { type: 'separator' },
            {
              label: 'Beam Alpha',
              submenu: [
                { label: 'Low (0.05)', type: 'radio', click: () => { win.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.05 }); } },
                { label: 'Medium (0.1)', type: 'radio', checked: true, click: () => { win.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.1 }); } },
                { label: 'High (0.2)', type: 'radio', click: () => { win.webContents.send('render-settings-command', { setting: 'beamAlpha', value: 0.2 }); } },
              ]
            },
            {
              label: 'Fade Alpha',
              submenu: [
                { label: 'Short (0.1)', type: 'radio', click: () => { win.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 0.1 }); } },
                { label: 'Medium (0.13)', type: 'radio', checked: true, click: () => { win.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 0.13 }); } },
                { label: 'Long (0.2)', type: 'radio', click: () => { win.webContents.send('render-settings-command', { setting: 'fadeAlpha', value: 0.2 }); } },
              ]
            },
            {
              label: 'Draw Speed',
              submenu: [
                { label: 'Slow (100)', type: 'radio', click: () => { win.webContents.send('render-settings-command', { setting: 'drawSpeed', value: 100 }); } },
                { label: 'Medium (500)', type: 'radio', click: () => { win.webContents.send('render-settings-command', { setting: 'drawSpeed', value: 500 }); } },
                { label: 'Fast (1000)', type: 'radio', checked: true, click: () => { win.webContents.send('render-settings-command', { setting: 'drawSpeed', value: 1000 }); } },
              ]
            },
          ]
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  ipcMain.on('show-layer-context-menu', (event, index) => {
    const layerContextMenu = Menu.buildFromTemplate([
      { label: 'Rename Layer', click: () => win.webContents.send('context-menu-action', { type: 'rename-layer', index: index }) },
      { label: 'Delete Layer', click: () => win.webContents.send('context-menu-action', { type: 'delete-layer', index: index }) },
    ]);
    layerContextMenu.popup({ window: win });
  });

  ipcMain.on('show-column-context-menu', (event, index) => {
    const columnContextMenu = Menu.buildFromTemplate([
      { label: 'Rename Column', click: () => win.webContents.send('context-menu-action', { type: 'rename-column', index: index }) },
      { label: 'Delete Column', click: () => win.webContents.send('context-menu-action', { type: 'delete-column', index: index }) },
    ]);
    columnContextMenu.popup({ window: win });
  });

  ipcMain.on('show-clip-context-menu', (event, layerIndex, colIndex) => {
    console.log(`Received show-clip-context-menu for layer: ${layerIndex}, column: ${colIndex}`); // Add log
    const clipContextMenu = Menu.buildFromTemplate([
      { label: 'Update Thumbnail', click: () => win.webContents.send('clip-context-command', { command: 'update-thumbnail', layerIndex, colIndex }) },
      { type: 'separator' },
      { label: 'Cut', click: () => win.webContents.send('clip-context-command', { command: 'cut-clip', layerIndex, colIndex }) },
      { label: 'Copy', click: () => win.webContents.send('clip-context-command', { command: 'copy-clip', layerIndex, colIndex }) },
      { label: 'Paste', click: () => win.webContents.send('clip-context-command', { command: 'paste-clip', layerIndex, colIndex }) },
      { type: 'separator' },
      { label: 'Rename', click: () => win.webContents.send('clip-context-command', { command: 'rename-clip', layerIndex, colIndex }) },
      { label: 'Clear', click: () => win.webContents.send('clip-context-command', { command: 'clear-clip', layerIndex, colIndex }) },
    ]);
    clipContextMenu.popup({ window: win });
  });

  // Listen for context menu actions from renderer and send back to renderer
  ipcMain.on('context-menu-action', (event, action) => {
    console.log(`Main process received context menu action: ${JSON.stringify(action)}`);
    win.webContents.send('context-menu-action-from-main', action);
  });

  ipcMain.handle('open-file-explorer', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
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