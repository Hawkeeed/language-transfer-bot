'use strict';

window.ReviewScreen = (function () {
  let allCards = [];
  let queue = [];
  let idx = 0;
  let current = null;
  let awaiting = false;
  let processing = false;
  let sessionId = 0;         // bumped on every (re)enter to invalidate in-flight turns
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
    // Invalidate any in-flight turn/playback left over from a previous run and
    // silence a lingering utterance from another screen.
    const my = ++sessionId;
    AudioIO.stop();
    awaiting = false;
    processing = false;
    current = null;

    let cards;
    try {
      cards = await window.SRS.loadAll();
    } catch (e) {
      UI.setStatus(statusEl, 'Could not load your review deck: ' + e.message, 'err');
      return;
    }
    if (my !== sessionId) return;              // navigated away while loading

    allCards = cards;
    queue = window.SRS.dueCards(allCards);     // same object refs as in allCards
    idx = 0;
    log.innerHTML = '';

    const hasCards = queue.length > 0;
    UI.el('review-empty').classList.toggle('hidden', hasCards);
    UI.el('review-card').classList.toggle('hidden', !hasCards);
    if (!hasCards) return;

    UI.applyInputMode(inputCfg, UI.settings.inputMode);
    UI.addBubble(log, 'system', `${queue.length} card(s) to review.`);
    await presentCard(my);
  }

  async function presentCard(my) {
    if (my !== sessionId) return;
    current = queue[idx];
    awaiting = false;
    const prompt = `Say this in German: "${current.en}"`;
    UI.addBubble(log, 'bot', prompt);
    UI.setStatus(statusEl, 'Speaking…');
    try { await AudioIO.speak(prompt, UI.settings, 'teacher'); } catch (e) { /* best-effort */ }
    if (my !== sessionId) return;              // left the screen during playback
    UI.setStatus(statusEl, 'Your turn — say it in German.');
    awaiting = true;
  }

  function handleUser(text) {
    if (!awaiting || processing) return;
    const answer = (text || '').trim();
    if (!answer) { UI.setStatus(statusEl, "Didn't catch that — try again.", 'err'); return; }
    awaiting = false;
    UI.addBubble(log, 'user', answer);
    grade(answer);
  }

  async function grade(text) {
    const my = sessionId;
    processing = true;
    UI.setStatus(statusEl, 'Checking…');
    const card = current;                      // pin the card this turn is grading

    let res;
    try { res = await UI.chatJSON(window.Prompts.reviewGradeMessages(card, text)); }
    catch (e) {
      if (my !== sessionId) return;            // navigated away mid-request — abort silently
      UI.setStatus(statusEl, e.message, 'err');
      processing = false;
      awaiting = true;                         // let them retry this card
      return;
    }
    if (my !== sessionId) return;              // a new run started; drop this stale turn

    let quality = parseInt(res.quality, 10);
    if (isNaN(quality)) quality = res.correct ? 4 : 1;
    quality = Math.max(0, Math.min(5, quality));

    // Mutates the very object that lives in allCards, then persists the deck.
    window.SRS.schedule(card, quality);
    try { await window.SRS.saveAll(allCards); }
    catch (e) { /* keep going; the in-memory schedule still stands this session */ }
    if (my !== sessionId) return;

    const ok = quality >= 3;
    const fb = `${ok ? '✔' : '✗'} ${res.feedback || ''}\nCorrect: ${card.de}`;
    UI.addBubble(log, 'system', fb);

    UI.setStatus(statusEl, 'Listen to the correct version…');
    try { await AudioIO.speak(card.de, UI.settings, 'german'); } catch (e) { /* best-effort */ }
    if (my !== sessionId) return;              // left the screen during playback
    UI.setStatus(statusEl, '');
    processing = false;

    idx++;
    if (idx < queue.length) await presentCard(my);
    else UI.addBubble(log, 'system', '🎉 Review complete! See you next time.');
  }

  return { init, enter };
})();
