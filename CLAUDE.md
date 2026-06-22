# CLAUDE.md — Project memory for `language-transfer-bot`

This file orients any future Claude Code session on this project. Read it first.

## What this is
A **desktop (Electron) app** to learn **German** following the **Language Transfer / "Thinking Method"** (Mihalis Eleftheriou). Powered by the **OpenAI API**. Built for an English speaker (the user is ~A2 with solid English) — German is taught **from English**.

## Design decisions (locked, from the planning interview)
1. **Method:** Language Transfer — think > memorise; constant oral production; transfer from English (cognates); strict incremental sequencing; warm tone.
2. **Modality:** hybrid — voice **and** text. Voice is primary.
3. **Architecture:** "Pipeline" (the cheap one, ~$8/mo): STT `gpt-4o-mini-transcribe` → LLM `gpt-4o-mini` → TTS `gpt-4o-mini-tts`. **No pronunciation scoring.**
4. **Transfer language:** **English** (pure), to exploit Germanic cognates.
5. **Curriculum:** **fixed sequence as data** (`data/curriculum.json`), LLM only acts as the teacher delivering it. Sequence is **original**, inspired by LT principles — never copy LT transcripts (copyright).
6. **API key:** the user's own, stored **locally + encrypted** via Electron `safeStorage`. Never embedded, never committed.
7. **Three sections:** (A) Guided Lesson, (B) Free Talk, (C) Review (SRS).
8. **Lesson correction:** hint → retry → reveal answer + why. Warm. **Tolerant of STT glitches** (judge construction, not spelling).
9. **Free Talk:** topic menu + custom topic; level selector (A1–B2); **deferred** correction (soft recasts) + **final summary** of top 3–5 errors.
10. **Memory:** current curriculum position + an **internal weakness profile** (no study dashboard) + SRS deck.
11. **SRS:** cards = **full sentences** (not isolated words), **auto-generated** from sessions/weak points, voice with optional text, **SM-2** algorithm.
12. **v1 scope:** ~8–10 foundational lessons; engine designed so scaling to ~50 is "just add data".
13. **Voice:** clear / slightly slow, Hochdeutsch. Two TTS modes: `teacher` (English coaching + authentic German pronunciation, used in Lesson & Review prompts) and `german` (pure German, used in Free Talk & spoken answers).
14. **UI language:** **100% English.** Content is German.
15. **Guided Lesson display:** **audio by default**, "Show text" reveals it.
16. **Repo:** public GitHub repo `language-transfer-bot`.

## Architecture / conventions
- **Process split (security):** API key + all OpenAI calls live in the **main process** (`src/main/`). The **renderer** only captures mic + plays audio. They communicate via IPC defined in `main.js` and exposed through `preload.js`'s `contextBridge` as `window.api.*`. `contextIsolation: true`, `nodeIntegration: false`.
- **Renderer is plain HTML/CSS/JS** (no bundler). Scripts attach to `window.*` globals and load in order in `index.html`; `renderer.js` loads last and orchestrates navigation + shared `window.UI` helpers.
- **System prompts** live in `src/renderer/prompts.js` (not secret).
- **SM-2** lives in `src/renderer/srs.js`.
- **Local data stores** (via `window.api.loadData/saveData`): `progress` (`{currentLesson}`), `weaknesses` (string[]), `srs` (card[]). Settings via `window.api.getSettings/setSettings`. All persisted as JSON in Electron `userData` by `src/main/storage.js`.
- LLM turns request **JSON** (`response_format: json_object`); see the shapes in `prompts.js`.

## Key files
- `main.js` — window + IPC handlers (key, settings, data, curriculum, ai:*).
- `preload.js` — the `window.api` bridge.
- `src/main/openai.js` — `testConnection`, `transcribe`, `chat`, `tts`. Model ids centralised in `MODELS`.
- `src/main/storage.js` — encrypted key + JSON stores.
- `src/renderer/renderer.js` — `window.UI` helpers (`chatJSON`, `addBubble`, `wireInput`, `applyInputMode`, `wireShowText`) + navigation.
- `src/renderer/audio.js` — `window.AudioIO` (record / transcribe / speak / replay).
- `src/renderer/screens/*.js` — `settings`, `lesson`, `freetalk`, `review`. Each is a `window.XScreen` with `init()` (wire once) + `enter()` (on navigate).
- `data/curriculum.json` — the lesson data (currently 8 lessons).

## Commands
- `npm start` — run the app (`electron .`).
- `npm run dist` — build a Windows installer (electron-builder).

## How to extend
- **More lessons:** append objects to `data/curriculum.json` following the existing `{id,title,concepts,steps:[{id,teach,prompts:[{en,de,notes}]}]}` shape. No code changes needed.
- **Pronunciation feedback (future):** would add an occasional `gpt-4o-audio` check; deliberately omitted for cost.

## Gotchas
- Public repo: `.gitignore` excludes `node_modules/`, `dist/`, and any `*.enc` / `*.json` data files. The API key lives in `userData`, never in the repo — keep it that way.
- `electron-store` is intentionally **not** used (ESM friction); storage is hand-rolled in `storage.js`.
- TTS reads mixed English+German in `teacher` mode — that is intentional (the LT teacher speaks English and pronounces the German).
