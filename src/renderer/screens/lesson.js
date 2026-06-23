'use strict';

window.LessonScreen = (function () {
  let curriculum = null;
  let customLessons = [];     // user-generated lessons, persisted in userData
  let activeLesson = '1';     // id of the lesson being studied (string; numeric for built-ins)
  let messages = [];          // chat history for the LLM
  let processing = false;
  let sessionId = 0;          // bumped on every (re)start to invalidate in-flight turns
  let log, statusEl, picker, inputCfg;

  function init() {
    log = UI.el('lesson-log');
    statusEl = UI.el('lesson-status');
    picker = UI.el('lesson-picker');

    UI.wireShowText(UI.el('lesson-show-text'), log);
    UI.el('lesson-replay').addEventListener('click', () => AudioIO.replayLast());
    UI.el('lesson-continue').addEventListener('click', handleContinue);

    // Create-your-own-lesson controls
    UI.el('lesson-new').addEventListener('click', showCreate);
    UI.el('lc-cancel').addEventListener('click', hideCreate);
    UI.el('lc-generate').addEventListener('click', generateLesson);
    UI.el('lc-topic').addEventListener('keydown', (e) => { if (e.key === 'Enter') generateLesson(); });

    inputCfg = {
      micBtn: UI.el('lesson-mic'),
      textInput: UI.el('lesson-text-input'),
      toggleBtn: UI.el('lesson-toggle-input'),
      stopAudioBtn: UI.el('lesson-stop-audio'),
      status: statusEl,
      onText: handleUser
    };
    UI.wireInput(inputCfg);

    picker.addEventListener('change', () => {
      if (picker.value === activeLesson) return;
      activeLesson = picker.value;
      startLesson();
    });
  }

  async function enter() {
    if (!curriculum) curriculum = await window.api.getCurriculum();
    customLessons = (await window.api.loadData('customLessons')) || [];

    const progress = await window.api.loadData('progress');
    let lessonId = (progress && progress.currentLesson) ? progress.currentLesson : 1;
    if (lessonId > curriculum.lessons.length) lessonId = curriculum.lessons.length;
    activeLesson = String(lessonId);

    rebuildPicker();
    picker.value = activeLesson;
    hideCreate();
    UI.applyInputMode(inputCfg, UI.settings.inputMode);
    UI.setActiveInput(inputCfg);   // hand Space-to-talk to this screen
    await startLesson();
  }

  function allLessons() {
    return curriculum.lessons.concat(customLessons);
  }

  function currentLessonObj() {
    return allLessons().find(l => String(l.id) === String(activeLesson)) || curriculum.lessons[0];
  }

  function displayTitle(l) {
    return l.custom ? `✦ ${l.title}` : `Lesson ${l.id}: ${l.title}`;
  }

  function addOption(parent, l, label) {
    const opt = document.createElement('option');
    opt.value = String(l.id);
    opt.textContent = label;
    parent.appendChild(opt);
  }

  function rebuildPicker() {
    picker.innerHTML = '';
    curriculum.lessons.forEach(l => addOption(picker, l, `Lesson ${l.id}: ${l.title}`));
    if (customLessons.length) {
      const og = document.createElement('optgroup');
      og.label = 'My lessons';
      customLessons.forEach(l => addOption(og, l, l.title));
      picker.appendChild(og);
    }
  }

  async function startLesson() {
    const lesson = currentLessonObj();
    UI.el('lesson-title').textContent = displayTitle(lesson);
    log.innerHTML = '';
    UI.setStatus(statusEl, '');
    AudioIO.stop();            // silence audio from the previous lesson and settle its
                               // pending playback promise so a stale turn can bail cleanly
    processing = false;        // reset any state left over from a previous lesson
    UI.setBusy(inputCfg, false); // re-enable input in case a stale turn left it disabled
    UI.el('lesson-continue').classList.add('hidden');
    sessionId++;               // invalidate any in-flight turn from the old lesson
    if (picker) picker.value = String(activeLesson);
    const weaknesses = (await window.api.loadData('weaknesses')) || [];
    messages = [{ role: 'system', content: window.Prompts.lessonSystem(lesson, weaknesses) }];
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
    const my = sessionId;
    processing = true;
    UI.setBusy(inputCfg, true);
    UI.setStatus(statusEl, 'Thinking…');
    let obj;
    try {
      obj = await UI.chatJSON(messages, { temperature: 0.4 });
    } catch (e) {
      if (my !== sessionId) return;          // lesson changed mid-request — abort silently
      UI.setStatus(statusEl, e.message, 'err');
      processing = false;
      UI.setBusy(inputCfg, false);
      return;
    }
    if (my !== sessionId) return;            // a new lesson started; drop this stale turn

    const say = obj.say || '';
    messages.push({ role: 'assistant', content: say });
    UI.addBubble(log, 'bot', say);

    if (obj.cardCandidate && obj.cardCandidate.de) {
      await window.SRS.addCards([{ en: obj.cardCandidate.en, de: obj.cardCandidate.de, source: 'lesson' }]);
      await addWeakness(obj.cardCandidate.en);
    }

    UI.setStatus(statusEl, 'Speaking…');
    try { await AudioIO.speak(say, UI.settings, 'teacher'); } catch (e) { /* audio is best-effort */ }
    if (my !== sessionId) return;            // lesson changed during playback
    processing = false;
    UI.setBusy(inputCfg, false);

    if (obj.lessonComplete) {
      setMode('done');
      await completeLesson();
    } else if (obj.expectGerman === false) {
      setMode('explain');     // teaching beat — wait for the learner to tap Continue
    } else {
      setMode('elicit');      // now waiting for the learner's German
    }
  }

  // Switch the control bar between teaching ('explain'), answering ('elicit')
  // and finished ('done') modes.
  function setMode(mode) {
    const cont = UI.el('lesson-continue');
    if (mode === 'explain') {
      cont.classList.remove('hidden');
      inputCfg.micBtn.classList.add('hidden');
      inputCfg.textInput.classList.add('hidden');
      inputCfg.toggleBtn.classList.add('hidden');
      UI.setActiveInput(null);          // Space-to-talk is inert; nothing to say yet
      UI.setStatus(statusEl, 'Listen, then Continue ▶');
      cont.focus();                     // so Enter/Space advances for keyboard users
    } else if (mode === 'elicit') {
      cont.classList.add('hidden');
      inputCfg.toggleBtn.classList.remove('hidden');
      UI.applyInputMode(inputCfg, UI.settings.inputMode);
      UI.setActiveInput(inputCfg);      // hand Space-to-talk back to this screen
      UI.setStatus(statusEl, '');
    } else { // done
      cont.classList.add('hidden');
      inputCfg.micBtn.classList.add('hidden');
      inputCfg.textInput.classList.add('hidden');
      inputCfg.toggleBtn.classList.add('hidden');
      UI.setActiveInput(null);
      UI.setStatus(statusEl, '');
    }
  }

  function handleContinue() {
    if (processing) return;
    UI.el('lesson-continue').classList.add('hidden');
    messages.push({ role: 'user', content: '(continue)' });
    botTurn();
  }

  async function completeLesson() {
    UI.addBubble(log, 'system', '✔ Lesson complete! Great work. Pick another lesson above, or head to Review.');
    const lesson = currentLessonObj();
    // Only built-in lessons advance the course progress counter.
    if (!lesson.custom && typeof lesson.id === 'number') {
      const progress = (await window.api.loadData('progress')) || {};
      const next = Math.min(lesson.id + 1, curriculum.lessons.length);
      progress.currentLesson = Math.max(progress.currentLesson || 1, next);
      await window.api.saveData('progress', progress);
    }
  }

  // ---------- Create your own lesson ----------
  function showCreate() {
    UI.el('lesson-create').classList.remove('hidden');
    UI.setStatus(UI.el('lc-status'), '');
    UI.el('lc-level').value = UI.settings.level || 'A2';
    UI.el('lc-topic').focus();
  }

  function hideCreate() {
    UI.el('lesson-create').classList.add('hidden');
  }

  async function generateLesson() {
    const topic = UI.el('lc-topic').value.trim();
    const lvl = UI.el('lc-level').value;
    const lcStatus = UI.el('lc-status');
    const genBtn = UI.el('lc-generate');
    if (!topic) { UI.setStatus(lcStatus, 'Type a topic first (e.g. "the dative case").', 'err'); return; }

    genBtn.disabled = true;
    UI.setStatus(lcStatus, 'Generating your lesson… this takes a few seconds.');
    let obj;
    try {
      obj = await UI.chatJSON(window.Prompts.generateLessonMessages(topic, lvl), { temperature: 0.5 });
    } catch (e) {
      UI.setStatus(lcStatus, e.message, 'err');
      genBtn.disabled = false;
      return;
    }

    const validSteps = obj && Array.isArray(obj.steps) && obj.steps.length &&
      obj.steps.every(s => Array.isArray(s.prompts) && s.prompts.length &&
        s.prompts.every(p => p && p.en && p.de));
    if (!validSteps) {
      UI.setStatus(lcStatus, 'The lesson came back malformed — try rephrasing the topic.', 'err');
      genBtn.disabled = false;
      return;
    }

    const lesson = {
      id: 'c' + Date.now(),
      title: (obj.title || topic).slice(0, 80),
      intro: obj.intro || '',
      concepts: Array.isArray(obj.concepts) ? obj.concepts : [],
      steps: obj.steps,
      custom: true,
      level: lvl
    };
    customLessons.push(lesson);
    try { await window.api.saveData('customLessons', customLessons); }
    catch (e) { UI.setStatus(lcStatus, 'Could not save the lesson: ' + e.message, 'err'); genBtn.disabled = false; return; }

    genBtn.disabled = false;
    UI.el('lc-topic').value = '';
    rebuildPicker();
    hideCreate();
    activeLesson = String(lesson.id);
    picker.value = activeLesson;
    await startLesson();
  }

  async function addWeakness(tag) {
    if (!tag) return;
    let w = (await window.api.loadData('weaknesses')) || [];
    if (!w.includes(tag)) { w.push(tag); if (w.length > 30) w = w.slice(-30); await window.api.saveData('weaknesses', w); }
  }

  return { init, enter };
})();
