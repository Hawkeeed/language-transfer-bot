'use strict';

window.SettingsScreen = (function () {

  function init() {
    UI.el('save-key').addEventListener('click', async () => {
      const key = UI.el('api-key').value.trim();
      if (!key) { UI.setStatus(UI.el('key-status'), 'Please paste a key first.', 'err'); return; }
      try {
        await window.api.setKey(key);
        UI.el('api-key').value = '';
        UI.setStatus(UI.el('key-status'), '✔ Key saved (encrypted on this computer).', 'ok');
      } catch (e) {
        UI.setStatus(UI.el('key-status'), '✗ Could not save key: ' + (e && e.message ? e.message : 'unknown error'), 'err');
      }
    });

    UI.el('test-conn').addEventListener('click', async () => {
      UI.setStatus(UI.el('test-result'), 'Testing…');
      const res = await window.api.testConnection();
      if (res.ok) UI.setStatus(UI.el('test-result'), '✔ Connection OK.', 'ok');
      else UI.setStatus(UI.el('test-result'), '✗ ' + res.error, 'err');
    });

    // Settings selects -> persist on change
    const bind = (id, key) => {
      UI.el(id).addEventListener('change', async (e) => {
        await window.api.setSettings({ [key]: e.target.value });
        await UI.refreshSettings();
        UI.setStatus(UI.el('settings-saved'), '✔ Saved.', 'ok');
      });
    };
    bind('setting-level', 'level');
    bind('setting-voice', 'voice');
    bind('setting-speed', 'speed');
    bind('setting-input', 'inputMode');
  }

  async function enter() {
    const s = await UI.refreshSettings();
    UI.el('setting-level').value = s.level;
    UI.el('setting-voice').value = s.voice;
    UI.el('setting-speed').value = s.speed;
    UI.el('setting-input').value = s.inputMode;
    const hasKey = await window.api.hasKey();
    UI.setStatus(UI.el('key-status'), hasKey ? '✔ A key is saved on this computer.' : 'No key saved yet.', hasKey ? 'ok' : '');
    UI.setStatus(UI.el('test-result'), '');
    UI.setStatus(UI.el('settings-saved'), '');
  }

  return { init, enter };
})();
