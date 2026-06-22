'use strict';

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

let baseDir = null;

const DEFAULT_SETTINGS = {
  level: 'A2',          // default CEFR level for Free Talk
  voice: 'alloy',       // OpenAI TTS voice
  speed: 'clear',       // 'clear' (slower, deliberate) | 'normal'
  inputMode: 'voice'    // 'voice' | 'text'
};

function init() {
  baseDir = app.getPath('userData');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
}

function filePath(name) {
  return path.join(baseDir, name);
}

function readJson(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.writeFileSync(filePath(name), JSON.stringify(value, null, 2), 'utf8');
  return true;
}

// ---------- API key (encrypted) ----------
const KEY_FILE = 'key.enc';

function setApiKey(key) {
  if (!key || typeof key !== 'string') throw new Error('Invalid API key');
  const trimmed = key.trim();
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(trimmed);
    fs.writeFileSync(filePath(KEY_FILE), encrypted);
  } else {
    // Fallback: OS-level encryption unavailable; store flagged plaintext.
    fs.writeFileSync(filePath(KEY_FILE), 'PLAIN:' + trimmed, 'utf8');
  }
  return true;
}

function getApiKey() {
  const p = filePath(KEY_FILE);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  if (buf.slice(0, 6).toString('utf8') === 'PLAIN:') {
    return buf.slice(6).toString('utf8');
  }
  try {
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

function hasApiKey() {
  return !!getApiKey();
}

function clearApiKey() {
  const p = filePath(KEY_FILE);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return true;
}

// ---------- Settings ----------
function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) };
}

function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson('settings.json', next);
  return next;
}

// ---------- Generic data (progress / srs / weaknesses) ----------
const ALLOWED = new Set(['progress', 'srs', 'weaknesses']);

function loadData(name) {
  if (!ALLOWED.has(name)) throw new Error('Unknown data store: ' + name);
  return readJson(name + '.json', null);
}

function saveData(name, value) {
  if (!ALLOWED.has(name)) throw new Error('Unknown data store: ' + name);
  return writeJson(name + '.json', value);
}

module.exports = {
  init,
  setApiKey,
  getApiKey,
  hasApiKey,
  clearApiKey,
  getSettings,
  setSettings,
  loadData,
  saveData
};
