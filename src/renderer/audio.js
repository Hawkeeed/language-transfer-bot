'use strict';

// Microphone capture (push-to-talk) + audio playback. Named AudioIO to avoid
// clashing with the built-in window.Audio constructor.
window.AudioIO = (function () {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let lastSpokenAudio = null; // ArrayBuffer of the last TTS clip, for replay

  // Currently-playing clip tracking. `playToken` is bumped on every stop() so a
  // clip that is interrupted can recognise it is stale and settle its promise
  // instead of hanging awaiting code.
  let currentAudio = null;
  let currentUrl = null;
  let playToken = 0;

  async function ensureStream() {
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    return stream;
  }

  async function startRecording() {
    await ensureStream();
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();
  }

  function stopRecording() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') { resolve(null); return; }
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const buf = await blob.arrayBuffer();
        resolve(buf);
      };
      recorder.stop();
    });
  }

  // Immediately stop and discard any currently-playing audio. Any pending
  // playback promise settles (resolves) because the clip's token no longer
  // matches the active token, so awaiting code can continue.
  function stop() {
    playToken++;            // invalidate the in-flight clip
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.src = '';
        currentAudio.load();
      } catch (e) { /* ignore */ }
      currentAudio = null;
    }
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
  }

  function playArrayBuffer(arrayBuffer) {
    return new Promise((resolve, reject) => {
      let url = null;
      try {
        const myToken = ++playToken; // this clip becomes the active one
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        currentUrl = url;

        const cleanup = () => {
          if (currentAudio === audio) currentAudio = null;
          if (currentUrl === url) currentUrl = null;
          URL.revokeObjectURL(url);
        };

        audio.onended = () => {
          if (myToken !== playToken) return; // already stopped/superseded
          cleanup();
          resolve();
        };
        audio.onerror = (e) => {
          if (myToken !== playToken) { resolve(); return; } // stopped — settle quietly
          cleanup();
          reject(e);
        };
        audio.play().catch((e) => {
          if (myToken !== playToken) { resolve(); return; }
          cleanup();
          reject(e);
        });
      } catch (e) {
        if (url) URL.revokeObjectURL(url);
        reject(e);
      }
    });
  }

  // Generate speech via the main process and play it. Returns when playback
  // ends (or is interrupted). Always stops any previous audio first so two
  // utterances can never overlap.
  async function speak(text, settings, mode) {
    stop(); // silence whatever is playing before we even fetch
    const res = await window.api.tts({
      text,
      voice: settings.voice,
      speed: settings.speed,
      mode: mode || 'german'
    });
    if (res.error) throw new Error(res.error);
    lastSpokenAudio = res.audio;
    await playArrayBuffer(res.audio);
  }

  async function replayLast() {
    if (lastSpokenAudio) {
      stop();
      await playArrayBuffer(lastSpokenAudio);
    }
  }

  // Transcribe an audio buffer to text via the main process.
  async function transcribe(arrayBuffer) {
    const res = await window.api.transcribe(arrayBuffer);
    if (res.error) throw new Error(res.error);
    return res.text;
  }

  return { startRecording, stopRecording, speak, stop, replayLast, transcribe };
})();
