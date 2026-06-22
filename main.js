'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const storage = require('./src/main/storage');
const openai = require('./src/main/openai');

let curriculumCache = null;
function loadCurriculum() {
  if (!curriculumCache) {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'curriculum.json'), 'utf8');
    curriculumCache = JSON.parse(raw);
  }
  return curriculumCache;
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: 'Language Transfer Bot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  storage.init();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  // ---- API key (encrypted at rest via safeStorage) ----
  ipcMain.handle('key:set', (_e, key) => storage.setApiKey(key));
  ipcMain.handle('key:has', () => storage.hasApiKey());
  ipcMain.handle('key:clear', () => storage.clearApiKey());

  // ---- Settings (level, voice, speed) ----
  ipcMain.handle('settings:get', () => storage.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => storage.setSettings(patch));

  // ---- Generic JSON data (progress / srs / weaknesses) ----
  ipcMain.handle('data:load', (_e, name) => storage.loadData(name));
  ipcMain.handle('data:save', (_e, name, value) => storage.saveData(name, value));

  // ---- Curriculum (read-only content shipped with the app) ----
  ipcMain.handle('curriculum:get', () => loadCurriculum());

  // ---- OpenAI primitives (key never leaves the main process) ----
  ipcMain.handle('ai:test', () => openai.testConnection());
  ipcMain.handle('ai:transcribe', (_e, arrayBuffer) => openai.transcribe(arrayBuffer));
  ipcMain.handle('ai:chat', (_e, opts) => openai.chat(opts));
  ipcMain.handle('ai:tts', (_e, opts) => openai.tts(opts));
}
