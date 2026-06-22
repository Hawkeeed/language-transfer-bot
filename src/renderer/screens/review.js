'use strict';

window.ReviewScreen = (function () {
  let allCards = [];
  let queue = [];
  let idx = 0;
  let current = null;
  let awaiting = false;
  let processing = false;
  let log, statusEl, inputCfg;

  function init() {
    log = UI.el('review-log');
    statusEl = UI.el('review-status');

    UI.wireShowText(UI.el('review-show-text'), log);
    UI.el('review-replay').addEventListener('click', () => AudioIO.replayLast());

    inputCfg = {
      micBtn: UI.el('review-mic'),
      textInput: UI.el('review-text-input'),
      toggleBtn: UI.el('review-toggle-input'),
      status: statusEl,
      onText: handleUser
    };
    UI.wireInput(inputCfg);
  }

  async function enter() {
    allCards = await window.SRS.loadAll();
    queue = window.SRS.dueCards(allCards);
    idx = 0;
    log.innerHTML = '';

    const hasCards = queue.length > 0;
    UI.el('review-empty').classList.toggle('hidden', hasCards);
    UI.el('review-card').classList.toggle('hidden', !hasCards);
    if (!hasCards) return;

    UI.applyInputMode(inputCfg, UI.settings.inputMode);
    UI.addBubble(log, 'system', `${queue.length} card(s) to review.`);
    await presentCard();
  }

  async function presentCard() {
    current = queue[idx];
    awaiting = false;
    const prompt = `Say this in German: "${current.en}"`;
    UI.addBubble(log, 'bot', prompt);
    UI.setStatus(statusEl, 'Speaking…');
    try { await AudioIO.speak(prompt, UI.settings, 'teacher'); } catch (e) { /* best-effort */ }
    UI.setStatus(statusEl, 'Your turn — say it in German.');
    awaiting = true;
  }

  function handleUser(text) {
    if (!awaiting || processing) return;
    awaiting = false;
    UI.addBubble(log, 'user', text);
    grade(text);
  }

  async function grade(text) {
    processing = true;
    UI.setStatus(statusEl, 'Checking…');
    let res;
    try { res = await UI.chatJSON(window.Prompts.reviewGradeMessages(current, text)); }
    catch (e) { UI.setStatus(statusEl, e.message, 'err'); processing = false; awaiting = true; return; }

    let quality = parseInt(res.quality, 10);
    if (isNaN(quality)) quality = res.correct ? 4 : 1;
    quality = Math.max(0, Math.min(5, quality));

    window.SRS.schedule(current, quality);
    await window.SRS.saveAll(allCards);

    const ok = quality >= 3;
    const fb = `${ok ? '✔' : '✗'} ${res.feedback || ''}\nCorrect: ${current.de}`;
    UI.addBubble(log, 'system', fb);

    UI.setStatus(statusEl, 'Listen to the correct version…');
    try { await AudioIO.speak(current.de, UI.settings, 'german'); } catch (e) { /* best-effort */ }
    UI.setStatus(statusEl, '');
    processing = false;

    idx++;
    if (idx < queue.length) await presentCard();
    else UI.addBubble(log, 'system', '🎉 Review complete! See you next time.');
  }

  return { init, enter };
})();
