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

  // The input controller for the screen currently on-screen. The global
  // Space-to-talk handler drives whichever controller is registered here.
  activeInput: null,

  // Wire a push-to-talk mic + a text input that both feed cfg.onText(text).
  // Returns a small controller object (also stored on cfg.controller) that the
  // global keyboard handler and the busy/disabled logic use.
  wireInput(cfg) {
    const MIC_IDLE = '🎤 Hold to speak';
    let recording = false;
    let busy = false;
    let timerId = null;
    let startedAt = 0;

    const stopTimer = () => {
      if (timerId) { clearInterval(timerId); timerId = null; }
    };

    const tickTimer = () => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const ss = String(secs % 60).padStart(2, '0');
      const mm = Math.floor(secs / 60);
      cfg.micBtn.textContent = `● Listening… ${mm}:${ss} (release to send)`;
    };

    const resetMic = () => {
      stopTimer();
      cfg.micBtn.classList.remove('recording');
      cfg.micBtn.setAttribute('aria-pressed', 'false');
      cfg.micBtn.textContent = MIC_IDLE;
    };

    const start = async () => {
      if (recording || busy) return;
      recording = true;
      startedAt = Date.now();
      cfg.micBtn.classList.add('recording');
      cfg.micBtn.setAttribute('aria-pressed', 'true');
      tickTimer();
      timerId = setInterval(tickTimer, 250);
      UI.setStatus(cfg.status, 'Listening… (release to send, Esc to cancel)');
      try { await AudioIO.startRecording(); }
      catch (e) {
        recording = false;
        resetMic();
        UI.setStatus(cfg.status, 'Microphone error: ' + e.message, 'err');
      }
    };

    // cancel === true discards the recording instead of sending it.
    const stop = async (cancel) => {
      if (!recording) return;
      recording = false;
      resetMic();
      const buf = await AudioIO.stopRecording();
      if (cancel) { UI.setStatus(cfg.status, 'Recording cancelled.'); return; }
      if (!buf) { UI.setStatus(cfg.status, ''); return; }
      UI.setStatus(cfg.status, 'Transcribing…');
      try {
        const text = await AudioIO.transcribe(buf);
        if (text) { UI.setStatus(cfg.status, ''); cfg.onText(text); }
        else UI.setStatus(cfg.status, "Didn't catch that — try again.", 'err');
      } catch (e) { UI.setStatus(cfg.status, e.message, 'err'); }
    };

    cfg.micBtn.addEventListener('mousedown', (e) => { e.preventDefault(); start(); });
    cfg.micBtn.addEventListener('mouseup', () => stop(false));
    cfg.micBtn.addEventListener('mouseleave', () => { if (recording) stop(false); });

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

    if (cfg.stopAudioBtn) {
      cfg.stopAudioBtn.addEventListener('click', () => {
        if (window.AudioIO) AudioIO.stop();
      });
    }

    const controller = {
      cfg,
      isRecording: () => recording,
      isBusy: () => busy,
      // True when this screen is in voice mode (mic visible).
      inVoiceMode: () => !cfg.micBtn.classList.contains('hidden'),
      start,
      stop,
      cancel: () => stop(true),
      // Disable/enable input affordances while the screen is thinking/speaking.
      setBusy(b) {
        busy = !!b;
        if (busy && recording) stop(true); // never leave a recording mid-flight
        cfg.micBtn.disabled = busy;
        cfg.textInput.disabled = busy;
        if (cfg.toggleBtn) cfg.toggleBtn.disabled = busy;
        cfg.micBtn.classList.toggle('is-busy', busy);
      }
    };
    cfg.controller = controller;
    return controller;
  },

  // Mark a screen busy (true while Thinking…/Speaking…). Disables its input.
  setBusy(cfg, busy) {
    if (cfg && cfg.controller) cfg.controller.setBusy(busy);
  },

  // Called by nav() so the global Space handler knows which screen owns the mic.
  setActiveInput(cfg) {
    UI.activeInput = (cfg && cfg.controller) ? cfg.controller : null;
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
  // Switching screens hands the global Space-to-talk handler to the new screen
  // (or to nobody on home/settings). Each screen re-asserts this in enter()
  // once its input is in the right mode, but clearing here is the safe default.
  UI.setActiveInput(null);

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

  wireGlobalKeys();

  await enterHome();
});

// ---------- Global push-to-talk (hold Spacebar) ----------
// Hold Space to record on the active screen; release to send. Only fires when:
//   - a screen with a wired voice input is active (UI.activeInput set),
//   - the screen is in voice mode (mic visible, not text mode),
//   - the screen is not busy (Thinking…/Speaking…),
//   - and focus is NOT in a text field / editable element.
// Esc cancels an in-progress recording (discards it).
function wireGlobalKeys() {
  let spaceHeld = false;

  const isTypingTarget = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  };

  const canTalk = () => {
    const ctrl = UI.activeInput;
    return !!ctrl && ctrl.inVoiceMode() && !ctrl.isBusy();
  };

  window.addEventListener('keydown', (e) => {
    // Esc: cancel an in-progress recording on the active screen.
    if (e.key === 'Escape' && UI.activeInput && UI.activeInput.isRecording()) {
      e.preventDefault();
      UI.activeInput.cancel();
      spaceHeld = false;
      return;
    }

    if (e.code !== 'Space') return;
    if (e.repeat) { if (canTalk()) e.preventDefault(); return; } // swallow auto-repeat
    if (isTypingTarget(e.target)) return;       // typing — let Space type a space
    if (!canTalk()) return;

    e.preventDefault();                          // stop the page from scrolling
    spaceHeld = true;
    UI.activeInput.start();
  });

  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    if (!spaceHeld) return;
    spaceHeld = false;
    e.preventDefault();
    if (UI.activeInput && UI.activeInput.isRecording()) UI.activeInput.stop(false);
  });

  // If focus leaves the window mid-hold, end the recording so it can't get stuck.
  window.addEventListener('blur', () => {
    if (spaceHeld) {
      spaceHeld = false;
      if (UI.activeInput && UI.activeInput.isRecording()) UI.activeInput.stop(false);
    }
  });
}
