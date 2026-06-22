'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge: the renderer can only call these named channels.
// The OpenAI API key stays in the main process and is never exposed here.
contextBridge.exposeInMainWorld('api', {
  // API key
  setKey: (key) => ipcRenderer.invoke('key:set', key),
  hasKey: () => ipcRenderer.invoke('key:has'),
  clearKey: () => ipcRenderer.invoke('key:clear'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // Local JSON data
  loadData: (name) => ipcRenderer.invoke('data:load', name),
  saveData: (name, value) => ipcRenderer.invoke('data:save', name, value),

  // Curriculum content
  getCurriculum: () => ipcRenderer.invoke('curriculum:get'),

  // OpenAI
  testConnection: () => ipcRenderer.invoke('ai:test'),
  transcribe: (arrayBuffer) => ipcRenderer.invoke('ai:transcribe', arrayBuffer),
  chat: (opts) => ipcRenderer.invoke('ai:chat', opts),
  tts: (opts) => ipcRenderer.invoke('ai:tts', opts)
});
