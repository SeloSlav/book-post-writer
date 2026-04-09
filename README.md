# Manuscript topic lab

Turn your book manuscripts (Word `.docx` files) into **topic-based essays**: the app reads your work, builds a searchable index with AI embeddings, and drafts a plain-text post grounded in *your* words. You describe what you want explored; the model proposes the public title and subtitle. Everything runs on your machine—no tie-in to a specific blog or publisher.

---

## What you get

- **Ingest & index** — Chunk and embed manuscripts from a folder you choose.
- **Generate** — Enter a brief (themes, angles, questions—not the final headline) and get an essay saved as a timestamped `.txt` file.
- **Optional voice** — Add samples of your published writing so new drafts feel like your cadence.
- **Editor + style audit** — A local web UI to polish drafts with auditing tools.

---

## Quick start (about five minutes)

1. **Install** — [Node.js 20+](https://nodejs.org/) if you do not already have it.
2. **Dependencies** — In the project folder, run:
   ```bash
   npm install
   ```
3. **API key** — Copy the example env file and add your OpenAI key:
   - **Windows (Command Prompt):** `copy .env.example .env`
   - **Windows (PowerShell):** `Copy-Item .env.example .env`
   - **macOS / Linux:** `cp .env.example .env`  
   Then open `.env` and set `OPENAI_API_KEY` to your key.
4. **Manuscripts** — Put your book `.docx` files in `data/books/`, *or* point the app elsewhere (see [Where your books live](#where-your-books-live) below).
5. **Run the app** — `npm run dev`, then open the URL the terminal prints (often [http://localhost:5173](http://localhost:5173)).
6. **First draft** — In the **Index & generator** area: run **Ingest** (books) → **Build vectors** → type your topic brief → **Generate post** (or **Full run**). Your draft appears in the **Post** pane and is saved under `data/output/` as `post-*.txt`.

That is the whole happy path. The sections below explain options, the command line, and what to do when something goes wrong.

---

## Prerequisites

| You need | Why |
| -------- | --- |
| **Node.js 20+** | Runs the app, pipeline, and local API. |
| **OpenAI API key** | Chat and embeddings (billing is on your OpenAI account). |

---

## Setup details

The npm package name is **`manuscript-topic-lab`**. If your folder name differs, you can rename the folder when nothing has it open (close the editor first).

**Optional config file** — For models, paths, and draft tuning, copy the example and edit:

```bash
copy pipeline.config.example.json pipeline.config.json
```

(On macOS/Linux use `cp` instead of `copy`.)

### Where your books live

The pipeline looks for `.docx` files in the folder set by:

- **`paths.books`** in `pipeline.config.json` (path **relative to the repo root**, e.g. `data/books`, or an **absolute** path on your computer), **or**
- **`PIPELINE_BOOKS`** in `.env` — overrides `paths.books` if set (handy on Windows, e.g. `PIPELINE_BOOKS=C:\MyNovels\Series`).

The UI status line shows which path the API is actually using.

**Draft tuning (optional)** — In `pipeline.config.json`, under `draft`:

- **`minWordCount`** — Minimum length of the essay *body* (title block not counted). Default **1100**; tweak if you want shorter or longer pieces (~1000–1200+ words is a common range).
- **`voiceEvidenceK`** — How many “voice” chunks go into the draft (similarity + spread across sample files). Raise it if you have large voice archives and want more cadence signal. Default **16**.

### Models (defaults and overrides)

- Default chat model: **`gpt-5.4`**. Optional **`models.reasoningEffort`**: `none`, `low`, `medium`, `high`, `xhigh`.
- Embeddings: **`text-embedding-3-small`**.
- If your key cannot use the default chat model, set **`models.chat`** in `pipeline.config.json` to another model id your account supports.

---

## Walkthrough: from `.docx` to a post

1. **Book folder** — Use `data/books/`, or set `paths.books` / `PIPELINE_BOOKS` as above. The browser does **not** upload files; the local API reads `.docx` from disk.
2. **Voice (optional)** — Add `.docx` or plain `.txt` samples of *your* writing under `data/voice/`. See `data/voice/README.txt`. After adding files, run **Ingest** for voice (or **All**) and **Build vectors** again.
3. **Topic box** — Treat it like a **creative brief**: what to explore, which angles matter, questions you want answered. You do **not** type the final headline there; the model generates title and subtitle with the essay.
4. **UI flow** — **Ingest** (Books / Voice / All) → **Build vectors** → **Generate post** or **Full run**. After a browser refresh, use **Reload from disk** if needed. Use **Style audit** on the right to refine tone and structure.
5. **CLI alternative** — Same pipeline from the terminal:

   ```bash
   npm run ingest:books   # or: npm run ingest:voice
   npm run embed
   npm run draft -- --prompt "What the post should cover..."
   ```

   Full rescan of books + voice: `npm run ingest`. One-shot ingest → embed → draft: `npm run full -- --prompt "…"`.

6. **Output** — Drafts land in `data/output/post-*.txt` (older runs might still show `substack-*.txt`).

---

## Folder cheat sheet

| Folder | Purpose |
| ------ | ------- |
| `data/books/` | Your manuscript `.docx` files (main source for the essay). |
| `data/voice/` | Optional writing samples for voice-matching. |
| `data/index/` | Generated `chunks.json`, `embeddings.json`, `topic-history.json`. |
| `data/output/` | Timestamped draft `.txt` files. |

More tips: `data/books/README.txt` and `data/voice/README.txt`.

---

## Commands reference

| Command | What it does |
| ------- | ------------ |
| `npm run ingest` | Ingest **all** books + voice → `data/index/chunks.json` (can be slow on huge corpora). |
| `npm run ingest:books` | Re-chunk **books only**; keeps existing voice chunks. |
| `npm run ingest:voice` | Re-chunk **voice** only; keeps existing book chunks. |
| `npm run embed` | Build embeddings → `data/index/embeddings.json`. |
| `npm run draft` | Draft from `--prompt` (12+ chars) → `data/output/post-*.txt`. |
| `npm run full` | Ingest → embed → draft (`--prompt` required). |
| `npm run pipeline:check` | Typecheck `pipeline/`, `cli/`, and `server/`. |
| `npm run dev` | **Recommended:** local editor API (port **8787**) + Vite dev server together. |
| `npm run dev:vite` | Frontend only (no `/api`—use if you skip the audit lab). |
| `npm run editor-api` | API only on 8787 (use with `dev:vite` in a second terminal if you prefer). |

### Two terminals instead of `npm run dev`

- Terminal 1: `npm run editor-api`
- Terminal 2: `npm run dev:vite`

### CLI examples

```bash
npx tsx cli/draft.ts --prompt "Topic ideas: themes, books, claims — not the final headline"
```

```bash
npx tsx cli/full.ts --prompt "Same kind of topic ideas as for draft"
```

### Browser UI notes

Open the Vite URL (often [http://localhost:5173](http://localhost:5173)). The **Post** pane is plain text—the same content as `post-*.txt`. **Run audit**, **Apply checked**, and **Apply with model** work on that text. The API reads `OPENAI_API_KEY` and `pipeline.config.json` from the **repo root**. Draft and full pipeline requests need a topic field (`customTopicPrompt` in the API)—the UI wires this for you.

---

## When something goes wrong

| Symptom | Things to check |
| ------- | ---------------- |
| Errors about API key | `OPENAI_API_KEY` is set in `.env` at the repo root; restart `npm run dev` after changes. |
| Empty or useless drafts | At least one `.docx` in your books folder; run **Ingest** then **Build vectors** before generating. |
| CLI exits non-zero | Usually missing key, missing book files, or missing embeddings before `draft` / `full`. Messages are short on purpose—read the last line. |
| Voice folder empty | Ingest does **not** fail if `data/voice/` is empty; voice is optional. |
| Port already in use | Another app may be on 5173 or 8787; stop it or adjust Vite / server config if you have customized ports. |

---

## Architecture

For module layout and pipeline order, see [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

Code layout in short: **UI** = Vite + React; **generation and indexing** = `pipeline/` and `cli/`; **local HTTP API** = `server/`.
