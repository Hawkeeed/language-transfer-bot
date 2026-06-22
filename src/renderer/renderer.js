'use strict';

// ---------- Shared UI helpers ----------
window.UI = {
  settings: null,

  el(id) { return document.getElementById(id); },

  setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  },

  addBubble(logEl, role, text, opts) {
    opts = opts || {};
    const div = document.createElement('div');
    div.className = 'bubble ' + role + (opts.cls ? ' ' + opts.cls : '');
    if (role === 'bot') {
      const note = document.createElement('span');
      note.className = 'masked-note';
      note.textContent = '🔊 spoken — turn on "Show text" to read';
      const content = document.createElement('span');
      content.className = 'content';
      content.textContent = text;
      div.appendChild(note);
      div.appendChild(content);
    } else {
      div.textContent = text;
    }
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  },

  // Ask the chat model for a JSON object and parse it.
  async chatJSON(messages, opts) {
    opts = opts || {};
    const res = await window.api.chat({ messages, json: true, temperature: opts.temperature });
    if (res.error) throw new Error(res.error);
    const text = res.text || '';
    try {
      const obj = JSON.parse(text);
      return (obj && typeof obj === 'object') ? obj : { say: String(obj) };
    } catch { return { say: text }; }
  },

  async refreshSettings() {
    window.UI.settings = await window.api.getSettings();
    return window.UI.settings;
  },

  // Wire a push-to-talk mic + a text input that both feed cfg.onText(text).
  wireInput(cfg) {
    let recording = false;

    const start = async () => {
      if (recording) return;
      recording = true;
      cfg.micBtn.classList.add('recording');
      cfg.micBtn.textContent = '● Recording… (release to send)';
      UI.setStatus(cfg.status, 'Listening…');
      try { await AudioIO.startRecording(); }
      catch (e) {
        recording = false;
        cfg.micBtn.classList.remove('recording');
        cfg.micBtn.textContent = '🎤 Hold to speak';
        UI.setStatus(cfg.status, 'Microphone error: ' + e.message, 'err');
      }
    };

    const stop = async () => {
      if (!recording) return;
      recording = false;
      cfg.micBtn.classList.remove('recording');
      cfg.micBtn.textContent = '🎤 Hold to speak';
      UI.setStatus(cfg.status, 'Transcribing…');
      const buf = await AudioIO.stopRecording();
      if (!buf) { UI.setStatus(cfg.status, ''); return; }
      try {
        const text = await AudioIO.transcribe(buf);
        if (text) { UI.setStatus(cfg.status, ''); cfg.onText(text); }
        else UI.setStatus(cfg.status, "Didn't catch that — try again.", 'err');
      } catch (e) { UI.setStatus(cfg.status, e.message, 'err'); }
    };

    cfg.micBtn.addEventListener('mousedown', start);
    cfg.micBtn.addEventListener('mouseup', stop);
    cfg.micBtn.addEventListener('mouseleave', () => { if (recording) stop(); });

    cfg.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && cfg.textInput.value.trim()) {
        const v = cfg.textInput.value.trim();
        cfg.textInput.value = '';
        cfg.onText(v);
      }
    });

    if (cfg.toggleBtn) {
      cfg.toggleBtn.addEventListener('click', () => {
        const textHidden = cfg.textInput.classList.contains('hidden');
        UI.applyInputMode(cfg, textHidden ? 'text' : 'voice');
        if (textHidden) cfg.textInput.focus();
      });
    }
  },

  applyInputMode(cfg, mode) {
    if (mode === 'text') {
      cfg.textInput.classList.remove('hidden');
      cfg.micBtn.classList.add('hidden');
      if (cfg.toggleBtn) cfg.toggleBtn.textContent = '🎤 Speak instead';
    } else {
      cfg.textInput.classList.add('hidden');
      cfg.micBtn.classList.remove('hidden');
      if (cfg.toggleBtn) cfg.toggleBtn.textContent = '⌨ Type instead';
    }
  },

  wireShowText(toggleBtn, logEl) {
    toggleBtn.addEventListener('click', () => {
      const on = logEl.classList.toggle('show-text');
      toggleBtn.textContent = on ? '🙈 Hide text' : '👁 Show text';
    });
  }
};

// ---------- Navigation ----------
const screens = {
  home: { enter: enterHome },
  settings: window.SettingsScreen,
  lesson: window.LessonScreen,
  freetalk: window.FreeTalkScreen,
  review: window.ReviewScreen
};

async function nav(name) {
  // Leaving any screen (or switching) silences in-flight TTS so it can't
  // bleed into the next screen.
  if (window.AudioIO && typeof AudioIO.stop === 'function') AudioIO.stop();

  // Gate the AI screens behind having an API key.
  if (['lesson', 'freetalk', 'review'].includes(name)) {
    const hasKey = await window.api.hasKey();
    if (!hasKey) {
      nav('home');
      UI.el('home-warning').classList.remove('hidden');
      return;
    }
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  UI.el('screen-' + name).classList.add('active');
  const screen = screens[name];
  if (screen && typeof screen.enter === 'function') {
    try { await screen.enter(); } catch (e) { console.error(e); }
  }
}
window.nav = nav;

async function enterHome() {
  const hasKey = await window.api.hasKey();
  UI.el('home-warning').classList.toggle('hidden', hasKey);

  // Lesson progress label
  const progress = await window.api.loadData('progress');
  const lessonNum = (progress && progress.currentLesson) ? progress.currentLesson : 1;
  UI.el('lesson-progress-label').textContent = 'Lesson ' + lessonNum;

  // Review due count
  const cards = await window.SRS.loadAll();
  const due = window.SRS.dueCards(cards).length;
  UI.el('review-due-label').textContent = due > 0 ? (due + ' due') : (cards.length ? 'All caught up' : 'No cards yet');
}

// ---------- Boot ----------
window.addEventListener('DOMContentLoaded', async () => {
  await UI.refreshSettings();

  // Wire global navigation (any element with data-go)
  document.querySelectorAll('[data-go]').forEach(btn => {
    btn.addEventListener('click', () => nav(btn.getAttribute('data-go')));
  });
  UI.el('open-settings').addEventListener('click', () => nav('settings'));

  // Init each screen once
  [window.SettingsScreen, window.LessonScreen, window.FreeTalkScreen, window.ReviewScreen]
    .forEach(s => { if (s && typeof s.init === 'function') s.init(); });

  await enterHome();
});
