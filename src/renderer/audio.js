'use strict';

// Microphone capture (push-to-talk) + audio playback. Named AudioIO to avoid
// clashing with the built-in window.Audio constructor.
window.AudioIO = (function () {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let lastSpokenAudio = null; // ArrayBuffer of the last TTS clip, for replay

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

  function playArrayBuffer(arrayBuffer) {
    return new Promise((resolve, reject) => {
      try {
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        audio.play();
      } catch (e) { reject(e); }
    });
  }

  // Generate speech via the main process and play it. Returns when playback ends.
  async function speak(text, settings, mode) {
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
    if (lastSpokenAudio) await playArrayBuffer(lastSpokenAudio);
  }

  // Transcribe an audio buffer to text via the main process.
  async function transcribe(arrayBuffer) {
    const res = await window.api.transcribe(arrayBuffer);
    if (res.error) throw new Error(res.error);
    return res.text;
  }

  return { startRecording, stopRecording, speak, replayLast, transcribe };
})();
