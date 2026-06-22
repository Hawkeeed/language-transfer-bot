'use strict';

window.FreeTalkScreen = (function () {
  let messages = [];
  let level = 'A2';
  let topic = '';
  let processing = false;
  let sessionId = 0;         // bumped on every (re)start/end to invalidate in-flight turns
  let active = false;        // true while a session is running (between start and end)
  let log, statusEl, inputCfg;

  function init() {
    log = UI.el('ft-log');
    statusEl = UI.el('ft-status');

    UI.el('ft-topic').addEventListener('change', (e) => {
      UI.el('ft-custom').classList.toggle('hidden', e.target.value !== '__custom__');
    });

    UI.el('ft-start').addEventListener('click', startSession);
    UI.el('ft-end').addEventListener('click', endSession);

    UI.wireShowText(UI.el('ft-show-text'), log);
    UI.el('ft-replay').addEventListener('click', () => AudioIO.replayLast());

    inputCfg = {
      micBtn: UI.el('ft-mic'),
      textInput: UI.el('ft-text-input'),
      toggleBtn: UI.el('ft-toggle-input'),
      status: statusEl,
      onText: handleUser
    };
    UI.wireInput(inputCfg);
  }

  function enter() {
    // Return to the setup screen. Silence any lingering audio and invalidate
    // any in-flight turn from a previous session.
    sessionId++;
    processing = false;
    active = false;
    messages = [];
    try { AudioIO.stop(); } catch (e) { /* best-effort */ }
    UI.el('freetalk-setup').classList.remove('hidden');
    UI.el('freetalk-session').classList.add('hidden');
    UI.el('ft-level').value = UI.settings.level || 'A2';
    UI.setStatus(statusEl, '');
  }

  async function startSession() {
    // Invalidate anything in flight and start clean.
    sessionId++;
    processing = false;
    active = true;
    try { AudioIO.stop(); } catch (e) { /* best-effort */ }

    level = UI.el('ft-level').value;
    const sel = UI.el('ft-topic').value;
    topic = sel === '__custom__' ? (UI.el('ft-custom').value.trim() || 'free conversation') : (sel || 'free conversation');

    UI.el('freetalk-setup').classList.add('hidden');
    UI.el('freetalk-session').classList.remove('hidden');
    log.innerHTML = '';
    log.classList.remove('show-text'); // bot speaks German; reading is opt-in again
    UI.applyInputMode(inputCfg, UI.settings.inputMode);
    UI.setStatus(statusEl, '');

    const my = sessionId;
    let weaknesses;
    try {
      weaknesses = (await window.api.loadData('weaknesses')) || [];
    } catch (e) {
      if (my !== sessionId) return;
      UI.setStatus(statusEl, e.message, 'err');
      return;
    }
    if (my !== sessionId) return;            // session changed while loading
    messages = [{ role: 'system', content: window.Prompts.freeTalkSystem(level, topic, weaknesses) }];
    await botTurn();
  }

  function handleUser(text) {
    if (!active || processing) return;
    UI.addBubble(log, 'user', text);
    messages.push({ role: 'user', content: text });
    botTurn();
  }

  async function botTurn() {
    if (processing) return;
    const my = sessionId;
    processing = true;
    UI.setStatus(statusEl, 'Thinking…');
    let obj;
    try {
      obj = await UI.chatJSON(messages, { temperature: 0.6 });
    } catch (e) {
      if (my !== sessionId) return;          // session changed mid-request — abort silently
      UI.setStatus(statusEl, e.message, 'err');
      processing = false;
      return;
    }
    if (my !== sessionId) return;            // a new/ended session — drop this stale turn

    const say = obj.say || '';
    messages.push({ role: 'assistant', content: say });
    UI.addBubble(log, 'bot', say);
    UI.setStatus(statusEl, 'Speaking…');
    try { await AudioIO.speak(say, UI.settings, 'german'); } catch (e) { /* audio is best-effort */ }
    if (my !== sessionId) return;            // session changed during playback
    UI.setStatus(statusEl, '');
    processing = false;
  }

  async function endSession() {
    if (processing) return;
    const turns = messages.filter(m => m.role !== 'system');
    // No learner turns yet — nothing to review; just return to setup.
    if (!turns.some(m => m.role === 'user')) { enter(); return; }

    // Mark the session over so any stray turn is invalidated, and silence audio.
    const my = ++sessionId;
    active = false;
    processing = true;
    try { AudioIO.stop(); } catch (e) { /* best-effort */ }
    UI.setStatus(statusEl, 'Preparing your feedback…');

    const transcript = turns.map(m => (m.role === 'user' ? 'Learner: ' : 'Partner: ') + m.content).join('\n');
    let fb;
    try {
      fb = await UI.chatJSON(window.Prompts.freeTalkSummaryMessages(transcript, level));
    } catch (e) {
      if (my !== sessionId) return;          // user navigated/restarted while feedback loaded
      UI.setStatus(statusEl, e.message, 'err');
      processing = false;
      return;
    }
    if (my !== sessionId) return;            // session changed; drop stale feedback

    try {
      renderFeedback(fb);
      log.classList.add('show-text'); // feedback is meant to be read

      if (Array.isArray(fb.cards) && fb.cards.length) {
        await window.SRS.addCards(fb.cards.map(c => ({ en: c.en, de: c.de, source: 'freetalk' })));
      }
      if (Array.isArray(fb.errors)) {
        for (const er of fb.errors) await addWeakness(er.why || er.correction);
      }
      UI.setStatus(statusEl, '✔ Session reviewed. Cards added to your Review deck.', 'ok');
    } catch (e) {
      UI.setStatus(statusEl, 'Saved feedback, but something went wrong: ' + e.message, 'err');
    } finally {
      processing = false;
    }
  }

  function renderFeedback(fb) {
    const block = document.createElement('div');
    block.className = 'feedback-block bubble';
    let html = '<h3>📋 Session feedback</h3>';
    if (fb.summary) html += `<p>${escapeHtml(fb.summary)}</p>`;
    if (Array.isArray(fb.errors) && fb.errors.length) {
      html += '<div>';
      for (const er of fb.errors) {
        html += `<div class="err-item">You said: <em>${escapeHtml(er.you_said || '')}</em><br>` +
                `<span class="corr">${escapeHtml(er.correction || '')}</span><br>` +
                `<small>${escapeHtml(er.why || '')}</small></div>`;
      }
      html += '</div>';
    }
    block.innerHTML = html;
    log.appendChild(block);
    log.scrollTop = log.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function addWeakness(tag) {
    if (!tag) return;
    let w = (await window.api.loadData('weaknesses')) || [];
    if (!w.includes(tag)) { w.push(tag); if (w.length > 30) w = w.slice(-30); await window.api.saveData('weaknesses', w); }
  }

  return { init, enter };
})();
