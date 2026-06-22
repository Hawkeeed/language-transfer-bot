'use strict';

// SM-2 spaced repetition (the classic Anki algorithm), plus a small store
// backed by the main process (data:load/save 'srs').
window.SRS = (function () {

  const DAY = 24 * 60 * 60 * 1000;

  function newCard(en, de, source) {
    return {
      id: 'c_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
      en, de,
      source: source || 'lesson',
      easiness: 2.5,
      interval: 0,        // in days
      repetitions: 0,
      dueDate: Date.now(),
      created: Date.now()
    };
  }

  // quality: 0..5
  function schedule(card, quality) {
    // Clamp/normalise inputs so a bad grade or a malformed card can't corrupt
    // the schedule (NaN intervals, negative due dates, etc.).
    quality = Math.max(0, Math.min(5, Math.round(Number(quality) || 0)));
    if (typeof card.easiness !== 'number' || !isFinite(card.easiness)) card.easiness = 2.5;
    if (typeof card.interval !== 'number' || !isFinite(card.interval)) card.interval = 0;
    if (typeof card.repetitions !== 'number' || !isFinite(card.repetitions)) card.repetitions = 0;

    if (quality < 3) {
      card.repetitions = 0;
      card.interval = 1;
    } else {
      card.repetitions += 1;
      if (card.repetitions === 1) card.interval = 1;
      else if (card.repetitions === 2) card.interval = 6;
      else card.interval = Math.round(card.interval * card.easiness);
    }
    // update easiness factor (canonical SM-2 formula), floored at 1.3
    card.easiness = card.easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (card.easiness < 1.3) card.easiness = 1.3;
    card.dueDate = Date.now() + card.interval * DAY;
    return card;
  }

  async function loadAll() {
    const data = await window.api.loadData('srs');
    return Array.isArray(data) ? data : [];
  }

  async function saveAll(cards) {
    await window.api.saveData('srs', cards);
  }

  // Avoid duplicates by German text.
  async function addCards(candidates) {
    if (!candidates || !candidates.length) return;
    const cards = await loadAll();
    const seen = new Set(cards.map(c => (c.de || '').toLowerCase().trim()));
    let added = 0;
    for (const c of candidates) {
      if (!c || !c.de || !c.en) continue;
      const key = c.de.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(newCard(c.en, c.de, c.source));
      added++;
    }
    if (added) await saveAll(cards);
    return added;
  }

  function dueCards(cards) {
    if (!Array.isArray(cards)) return [];
    const now = Date.now();
    // A card with no/invalid dueDate is treated as due now (new or migrated card).
    return cards.filter(c => c && (typeof c.dueDate !== 'number' || !isFinite(c.dueDate) || c.dueDate <= now));
  }

  return { newCard, schedule, loadAll, saveAll, addCards, dueCards };
})();
