# Language Transfer Bot 🇩🇪

A desktop app to learn **German** using the spirit of the **Language Transfer / "Thinking Method"** by Mihalis Eleftheriou — *think, don't memorise* — powered by the OpenAI API.

It is built for an English speaker learning German: it builds the language **from English**, leaning on the cognates and shared patterns the two Germanic languages have in common.

> The curriculum here is **original content inspired by the Language Transfer principles** — it does not copy any of Language Transfer's lessons or transcripts.

## ✨ Features

- **🎓 Guided Lesson** — the core method. The bot poses a phrase, you say it in German out loud, and it corrects you the Language-Transfer way: a *hint first*, a chance to retry, then the answer + the *why*. Audio-first (text hidden by default; reveal it any time).
- **💬 Free Talk** — pick a topic and a level (A1–B2) and just talk. The bot speaks only German, corrects gently with soft *recasts*, and gives you a written summary of your top mistakes at the end.
- **🔁 Review** — spaced repetition (SM-2) of the *full sentences* you've built. Cards are generated automatically from the things you struggled with.

## 🧠 How it works (architecture)

A cheap **"pipeline"** of OpenAI APIs (≈ $8/month at ~30 min/day):

```
your voice → STT (gpt-4o-mini-transcribe)
           → teacher LLM (gpt-4o-mini)
           → TTS (gpt-4o-mini-tts) → the bot's voice
```

- Built with **Electron**. The OpenAI API key and **all** network calls live in the **main process**; the UI (renderer) only records the mic and plays audio. They talk over secure IPC.
- Your **API key is stored encrypted on your machine** (Electron `safeStorage` → Windows credential store). It is never uploaded and never committed to the repo.
- Your progress, weakness profile and review deck are plain JSON files in Electron's `userData` folder — **not** in this repo.

## 🚀 Getting started

### Requirements
- [Node.js](https://nodejs.org/) 18+ (tested on 20)
- An **OpenAI API key** with billing enabled (this is the pay-as-you-go API, *not* a ChatGPT Plus subscription)

### Install & run
```bash
npm install
npm start
```

On first launch:
1. Open **⚙ Settings**.
2. Paste your OpenAI API key and click **Save**, then **Test connection**.
3. Go back and start a **Guided Lesson**.

> Tip: hold the **🎤 Hold to speak** button while you talk, release to send. Prefer typing? Click **⌨ Type instead**.

### Build a Windows installer (optional)
```bash
npm run dist
```

## 💸 Cost
You pay OpenAI directly for your own usage. With the pipeline architecture, thinking pauses are free, so a typical 20-minute session costs roughly **$0.15–$0.25**.

## 🗂️ Project layout
```
main.js              Electron main process + IPC handlers
preload.js           Secure bridge (contextBridge) to the renderer
src/main/            openai.js (STT/LLM/TTS), storage.js (key + JSON)
src/renderer/        UI: screens, audio capture/playback, prompts, SM-2
data/curriculum.json The Language-Transfer-inspired German lesson sequence
```

## 📈 Roadmap
- Expand the curriculum from 8 foundational lessons toward a full ~50-lesson course (just add data — the engine is done).
- Optional pronunciation feedback.
- More Free Talk topics and an "instant correction" toggle.

## 📜 License
MIT.
