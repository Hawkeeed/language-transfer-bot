'use strict';

const { OpenAI, toFile } = require('openai');
const storage = require('./storage');

const MODELS = {
  chat: 'gpt-4o-mini',
  stt: 'gpt-4o-mini-transcribe',
  tts: 'gpt-4o-mini-tts'
};

let cached = { key: null, client: null };

function getClient() {
  const key = storage.getApiKey();
  if (!key) throw new Error('No API key set. Open Settings and add your OpenAI API key.');
  if (cached.client && cached.key === key) return cached.client;
  cached = { key, client: new OpenAI({ apiKey: key }) };
  return cached.client;
}

function friendly(err) {
  const status = err && err.status;
  if (status === 401) return 'Invalid API key (401). Check it in Settings.';
  if (status === 429) return 'Rate limit or no credit (429). Check your OpenAI billing.';
  if (status === 500 || status === 503) return 'OpenAI server error. Try again in a moment.';
  return (err && err.message) ? err.message : 'Unknown error.';
}

async function testConnection() {
  try {
    const client = getClient();
    await client.models.list();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendly(err) };
  }
}

// arrayBuffer = raw audio bytes (webm/opus) captured by MediaRecorder in the renderer
async function transcribe(arrayBuffer) {
  try {
    const client = getClient();
    const file = await toFile(Buffer.from(arrayBuffer), 'speech.webm', { type: 'audio/webm' });
    const res = await client.audio.transcriptions.create({
      file,
      model: MODELS.stt
    });
    return { text: (res.text || '').trim() };
  } catch (err) {
    return { error: friendly(err) };
  }
}

// opts: { messages: [...], temperature?, json?, model? }
async function chat(opts) {
  try {
    const client = getClient();
    const res = await client.chat.completions.create({
      model: opts.model || MODELS.chat,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    });
    return { text: res.choices[0].message.content };
  } catch (err) {
    return { error: friendly(err) };
  }
}

// opts: { text, voice?, speed?, mode? }  mode: 'teacher' | 'german'  -> returns { audio: ArrayBuffer (mp3) }
async function tts(opts) {
  try {
    const client = getClient();
    const speed = opts.speed || 'clear';
    const mode = opts.mode || 'german';
    const pace = speed === 'clear' ? ' Speak a little slower than normal, with careful, precise pronunciation.' : '';
    const instructions = mode === 'teacher'
      ? 'You are a calm, encouraging English-speaking German teacher. Speak the English parts naturally, but pronounce every German word and phrase with authentic standard High German (Hochdeutsch) pronunciation.' + pace
      : 'Speak in standard High German (Hochdeutsch), like a friendly native speaker.' + pace;
    const res = await client.audio.speech.create({
      model: MODELS.tts,
      voice: opts.voice || 'alloy',
      input: opts.text,
      instructions,
      response_format: 'mp3'
    });
    const audio = await res.arrayBuffer();
    return { audio };
  } catch (err) {
    return { error: friendly(err) };
  }
}

module.exports = { testConnection, transcribe, chat, tts, MODELS };
