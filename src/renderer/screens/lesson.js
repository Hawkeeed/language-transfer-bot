'use strict';

window.LessonScreen = (function () {
  let curriculum = null;
  let activeLesson = 1;      // lesson currently being studied
  let messages = [];         // chat history for the LLM
  let processing = false;
  let sessionId = 0;         // bumped on every (re)start to invalidate in-flight turns
  let log, statusEl, picker, inputCfg;

  function init() {
    log = UI.el('lesson-log');
    statusEl = UI.el('lesson-status');
    picker = UI.el('lesson-picker');

    UI.wireShowText(UI.el('lesson-show-text'), log);
    UI.el('lesson-replay').addEventListener('click', () => AudioIO.replayLast());

    inputCfg = {
      micBtn: UI.el('lesson-mic'),
      textInput: UI.el('lesson-text-input'),
      toggleBtn: UI.el('lesson-toggle-input'),
      status: statusEl,
      onText: handleUser
    };
    UI.wireInput(inputCfg);

    picker.addEventListener('change', () => {
      const chosen = parseInt(picker.value, 10);
      if (chosen === activeLesson) return;
      activeLesson = chosen;
      startLesson();
    });
  }

  async function enter() {
    if (!curriculum) curriculum = await window.api.getCurriculum();
    const progress = await window.api.loadData('progress');
    activeLesson = (progress && progress.currentLesson) ? progress.currentLesson : 1;
    if (activeLesson > curriculum.lessons.length) activeLesson = curriculum.lessons.length;

    if (!picker.options.length) {
      curriculum.lessons.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = `Lesson ${l.id}: ${l.title}`;
        picker.appendChild(opt);
      });
    }
    picker.value = String(activeLesson);
    UI.applyInputMode(inputCfg, UI.settings.inputMode);
    await startLesson();
  }

  function currentLessonObj() {
    return curriculum.lessons.find(l => l.id === activeLesson) || curriculum.lessons[0];
  }

  async function startLesson() {
    const lesson = currentLessonObj();
    UI.el('lesson-title').textContent = `Lesson ${lesson.id}: ${lesson.title}`;
    log.innerHTML = '';
    UI.setStatus(statusEl, '');
    AudioIO.stop();            // silence any audio from the previous lesson and
                               // settle its pending playback promise so the
                               // stale in-flight turn can bail cleanly
    processing = false;        // reset any state left over from a previous lesson
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
    UI.setStatus(statusEl, 'Thinking…');
    let obj;
    try {
      obj = await UI.chatJSON(messages, { temperature: 0.4 });
    } catch (e) {
      if (my !== sessionId) return;          // lesson changed mid-request — abort silently
      UI.setStatus(statusEl, e.message, 'err');
      processing = false;
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
    UI.setStatus(statusEl, '');
    processing = false;

    if (obj.lessonComplete) await completeLesson();
  }

  async function completeLesson() {
    UI.addBubble(log, 'system', '✔ Lesson complete! Great work. Pick the next lesson above, or come back for Review.');
    const progress = (await window.api.loadData('progress')) || {};
    const next = Math.min(activeLesson + 1, curriculum.lessons.length);
    progress.currentLesson = Math.max(progress.currentLesson || 1, next);
    await window.api.saveData('progress', progress);
  }

  async function addWeakness(tag) {
    if (!tag) return;
    let w = (await window.api.loadData('weaknesses')) || [];
    if (!w.includes(tag)) { w.push(tag); if (w.length > 30) w = w.slice(-30); await window.api.saveData('weaknesses', w); }
  }

  return { init, enter };
})();
