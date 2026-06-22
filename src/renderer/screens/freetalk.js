'use strict';

window.FreeTalkScreen = (function () {
  let messages = [];
  let level = 'A2';
  let topic = '';
  let processing = false;
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
    UI.el('freetalk-setup').classList.remove('hidden');
    UI.el('freetalk-session').classList.add('hidden');
    UI.el('ft-level').value = UI.settings.level || 'A2';
    UI.setStatus(statusEl, '');
  }

  async function startSession() {
    level = UI.el('ft-level').value;
    const sel = UI.el('ft-topic').value;
    topic = sel === '__custom__' ? (UI.el('ft-custom').value.trim() || 'free conversation') : sel;

    UI.el('freetalk-setup').classList.add('hidden');
    UI.el('freetalk-session').classList.remove('hidden');
    log.innerHTML = '';
    UI.applyInputMode(inputCfg, UI.settings.inputMode);

    const weaknesses = (await window.api.loadData('weaknesses')) || [];
    messages = [{ role: 'system', content: window.Prompts.freeTalkSystem(level, topic, weaknesses) }];
    await botTurn();
  }

  function handleUser(text) {
    if (processing) return;
    UI.addBubble(log, 'user', text);
    messages.push({ role: 'user', content: text });
    botTurn();
  }

  async function botTurn() {
    if (processing) return;
    processing = true;
    UI.setStatus(statusEl, 'Thinking…');
    let obj;
    try { obj = await UI.chatJSON(messages, { temperature: 0.6 }); }
    catch (e) { UI.setStatus(statusEl, e.message, 'err'); processing = false; return; }
    const say = obj.say || '';
    messages.push({ role: 'assistant', content: say });
    UI.addBubble(log, 'bot', say);
    UI.setStatus(statusEl, 'Speaking…');
    try { await AudioIO.speak(say, UI.settings, 'german'); } catch (e) { /* best-effort */ }
    UI.setStatus(statusEl, '');
    processing = false;
  }

  async function endSession() {
    if (processing) return;
    const turns = messages.filter(m => m.role !== 'system');
    if (!turns.some(m => m.role === 'user')) { enter(); return; }
    processing = true;
    UI.setStatus(statusEl, 'Preparing your feedback…');
    const transcript = turns.map(m => (m.role === 'user' ? 'Learner: ' : 'Partner: ') + m.content).join('\n');
    let fb;
    try { fb = await UI.chatJSON(window.Prompts.freeTalkSummaryMessages(transcript, level)); }
    catch (e) { UI.setStatus(statusEl, e.message, 'err'); processing = false; return; }

    renderFeedback(fb);
    log.classList.add('show-text'); // feedback is meant to be read

    if (Array.isArray(fb.cards) && fb.cards.length) {
      await window.SRS.addCards(fb.cards.map(c => ({ en: c.en, de: c.de, source: 'freetalk' })));
    }
    if (Array.isArray(fb.errors)) {
      for (const er of fb.errors) await addWeakness(er.why || er.correction);
    }
    UI.setStatus(statusEl, '✔ Session reviewed. Cards added to your Review deck.', 'ok');
    processing = false;
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
