# Book Post Writer

### For writers who’d rather be writing than fighting software 📚

If you have **Word manuscripts** and need **newsletter posts, threads, or essays** that still sound like *your* story (not a generic chatbot essay), this tool is for you. You describe the idea; it drafts text you can edit. **No publishing platform is required:** you get plain files you can paste anywhere.

---

### You don’t have to be “good with computers” ✨

- **Never used GitHub?** That’s normal. Think of it as a **safe download page** for this project: you click **Code → Download ZIP**, unzip the folder, and follow the steps below. You are not “joining a club.” You’re just grabbing a copy of the app, like saving a file from email. (If you *do* use Git, clone works too, same result.)
- **Your books stay on your machine.** The app reads your `.docx` files from a folder **you** choose. We’re not running a website that stores your novels in the cloud.
- **This app is free and open source.** The part that *writes* text for you is an outside AI service. You put an **API key** (a secret code from that provider) in a file on your computer so only *your* account is charged when *you* run a draft. Typical cloud usage is small per run (often “coffee money,” not rent), or you can explore **self-hosted / open models** (see below). Book Post Writer is just the workspace; the model does the heavy lifting when you ask it to.

---

### “API key” in human words 🔑

An **API key** is like a **password that only lets the AI bill *your* account** when *you* click “write draft.” You create it on the provider’s site and paste it into `.env` in this project (Quick start shows how).

#### Where to get API keys (pick one path to start)

| If you want… | Get a key here | Notes |
| ------------ | -------------- | ----- |
| **OpenAI** (what this repo uses out of the box) | [OpenAI API keys](https://platform.openai.com/api-keys) | Needs [OpenAI](https://platform.openai.com/) account; [usage pricing](https://openai.com/api/pricing/) is on their site. |
| **Anthropic (Claude)** | [Anthropic Console](https://console.anthropic.com/) | Wiring into *this* codebase is DIY today; see [Technical details](#technical-details). |
| **Many models, one dashboard** | [OpenRouter API keys](https://openrouter.ai/keys) | Useful if you like to experiment; still requires code changes to use here. |

#### Cloud vs “open” / local setups

- **Paid cloud APIs** (OpenAI, Anthropic, etc.): you register, add a payment method if required, create a key, paste it into `.env`. No key is stored by us; it never leaves your machine except when the app calls the provider.
- **Open-source / self-hosted direction:** tools like **[Ollama](https://ollama.com/)** or **[LM Studio](https://lmstudio.ai/)** let you run models **on your own computer** with **no per-token bill** to a big vendor (your hardware does the work). This repo does **not** ship a one-click Ollama mode yet; hooking it up means developer work (same bucket as “use Claude instead”: small codebase, but you or Cursor / Claude Code would adapt the API calls).

**This version of the app is set up for OpenAI first** (create an account, add billing if prompted, copy a key into `.env`; Quick start walks through it).

**Prefer Claude, OpenRouter, or a local model?** The project is open source; if you use **Cursor**, **Claude Code**, or a developer friend, swapping or adding another backend is doable. It’s **not** a one-click switch today, but you’re not locked into a black box.

You can ignore the jargon: follow the numbered steps in **Quick start** and you’ll only touch the key once.

---

## What you get (plain English)

- **Load your books** 📂: One manuscript or a whole series of Word files in a folder. Nothing gets “uploaded” to us; the app reads from your disk.
- **Describe the post, not the headline** ✍️: A short note: themes, questions, which characters or ideas matter. You get a **text file** you can copy into Substack, Mailchimp, Notes, wherever.
- **Optional: match your voice** 🎙️: Drop in samples of writing you’ve already published so drafts feel closer to how you usually sound.
- **Edit on screen** 🖥️: Buttons spell out what they do. Get suggestions, accept changes line by line or rewrite the whole draft, then **save** when it looks right.

---

## Quick start (about five minutes)

1. **Install**: [Node.js 20+](https://nodejs.org/) if you do not already have it.
2. **Dependencies**: In the project folder, run:
   ```bash
   npm install
   ```
3. **API key**: Copy the example env file and add your OpenAI key (re-read **“API key” in human words** above if the phrase “API key” makes you nervous). Create a key at [OpenAI API keys](https://platform.openai.com/api-keys) if you do not have one.
   - **Windows (Command Prompt):** `copy .env.example .env`
   - **Windows (PowerShell):** `Copy-Item .env.example .env`
   - **macOS / Linux:** `cp .env.example .env`  
   Then open `.env` and set `OPENAI_API_KEY` to your key.
4. **Manuscripts**: Put your book `.docx` files in `data/books/`, *or* point the app elsewhere (see [Where your books live](#where-your-books-live) below).
5. **Run the app**: `npm run dev`, then open the URL the terminal prints (often [http://localhost:5173](http://localhost:5173)).
6. **First draft**: In the **Load your books, then generate a post** section: **Scan my Word books (.docx)** → **Connect sources to the writer** → describe the post in the topic box → **Write draft post** (or **Do all steps automatically (slow)**). Your draft appears in **Your post draft** on the left and is saved under `data/output/` as `post-*.txt`.

That is the whole happy path. The sections below explain options, the command line, and what to do when something goes wrong.

---

## Prerequisites

| You need | Why |
| -------- | --- |
| **Node.js 20+** | Runs the app, pipeline, and local API. |
| **OpenAI API key** (for default setup) | Chat and embeddings (billing is on your OpenAI account). [Get a key](https://platform.openai.com/api-keys). |

---

## Setup details

The npm package name is **`book-post-writer`**. If your folder name differs, you can rename the folder when nothing has it open (close the editor first).

**Optional config file**: For models, paths, and draft tuning, copy the example and edit:

```bash
copy pipeline.config.example.json pipeline.config.json
```

(On macOS/Linux use `cp` instead of `copy`.)

### Where your books live

The pipeline looks for `.docx` files in the folder set by:

- **`paths.books`** in `pipeline.config.json` (path **relative to the repo root**, e.g. `data/books`, or an **absolute** path on your computer), **or**
- **`PIPELINE_BOOKS`** in `.env` overrides `paths.books` if set (handy on Windows, e.g. `PIPELINE_BOOKS=C:\MyNovels\Series`).

The UI status line shows which path the API is actually using.

**Draft tuning (optional)**: In `pipeline.config.json`, under `draft`:

- **`minWordCount`**: Minimum length of the essay *body* (title block not counted). Default **1100**; tweak if you want shorter or longer pieces (about 1000 to 1200+ words is a common range).
- **`voiceEvidenceK`**: How many “voice” chunks go into the draft (similarity + spread across sample files). Raise it if you have large voice archives and want more cadence signal. Default **16**.

### Models (defaults and overrides)

- Default chat model: **`gpt-5.4`**. Optional **`models.reasoningEffort`**: `none`, `low`, `medium`, `high`, `xhigh`.
- Embeddings: **`text-embedding-3-small`**.
- If your key cannot use the default chat model, set **`models.chat`** in `pipeline.config.json` to another model id your account supports.

---

## Walkthrough: from `.docx` to a post

1. **Book folder**: Use `data/books/`, or set `paths.books` / `PIPELINE_BOOKS` as above. The browser does **not** upload files; the local API reads `.docx` from disk.
2. **Voice (optional)**: Add `.docx` or plain `.txt` samples of *your* writing under `data/voice/`. See `data/voice/README.txt`. After adding files, run **Scan my writing samples** (or **Scan everything (slow)**) and **Connect sources to the writer** again.
3. **Topic box**: Treat it like a **creative brief**: what to explore, which angles matter, questions you want answered. You do **not** type the final headline there; the model generates title and subtitle with the essay.
4. **UI flow**: Scan books and/or voice → **Connect sources to the writer** → **Write draft post** or **Do all steps automatically (slow)**. After a browser refresh, use **Open last saved draft from disk** if needed. Use **Get writing suggestions** and **Suggestions & edits** on the right to refine wording.
5. **CLI alternative**: Same pipeline from the terminal:

   ```bash
   npm run ingest:books   # or: npm run ingest:voice
   npm run embed
   npm run draft -- --prompt "What the post should cover..."
   ```

   Full rescan of books + voice: `npm run ingest`. One-shot ingest → embed → draft: `npm run full -- --prompt "…"`.

6. **Output**: Drafts land in `data/output/post-*.txt` (older runs might still show `substack-*.txt`).

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
| `npm run dev:vite` | Frontend only (no `/api`; use if you skip the local editor API and suggestions UI). |
| `npm run editor-api` | API only on 8787 (use with `dev:vite` in a second terminal if you prefer). |

### Two terminals instead of `npm run dev`

- Terminal 1: `npm run editor-api`
- Terminal 2: `npm run dev:vite`

### CLI examples

```bash
npx tsx cli/draft.ts --prompt "Topic ideas: themes, books, claims, not the final headline"
```

```bash
npx tsx cli/full.ts --prompt "Same kind of topic ideas as for draft"
```

### Browser UI notes

Open the Vite URL (often [http://localhost:5173](http://localhost:5173)). **Your post draft** (left) is plain text, the same content as `post-*.txt`. **Get writing suggestions**, **Apply checked changes to draft**, and **Rewrite whole draft with AI** work on that text. The API reads `OPENAI_API_KEY` and `pipeline.config.json` from the **repo root**. Draft and full pipeline requests need a topic field (`customTopicPrompt` in the API). The UI wires this for you.

---

## When something goes wrong

| Symptom | Things to check |
| ------- | ---------------- |
| Errors about API key | `OPENAI_API_KEY` is set in `.env` at the repo root; restart `npm run dev` after changes. Confirm the key at [OpenAI API keys](https://platform.openai.com/api-keys). |
| Empty or useless drafts | At least one `.docx` in your books folder; scan sources then **Connect sources to the writer** before **Write draft post**. |
| CLI exits non-zero | Usually missing key, missing book files, or missing embeddings before `draft` / `full`. Messages are short on purpose. Read the last line. |
| Voice folder empty | Ingest does **not** fail if `data/voice/` is empty; voice is optional. |
| Port already in use | Another app may be on 5173 or 8787; stop it or adjust Vite / server config if you have customized ports. |

---

## Technical details

*For developers, tinkerers, and anyone who likes the full picture.*

### What happens under the hood

- **Ingest & index**: Manuscripts are read from disk, split into chunks, and indexed with **OpenAI embeddings** so retrieval can pull relevant passages for a given topic.
- **Generate / draft**: A chat model (default **`gpt-5.4`**) writes a plain-text post using retrieved evidence from your books (and optional voice samples). You supply a **topic brief**; the model proposes **title and subtitle** plus body. Output is timestamped `.txt` under `data/output/`.
- **Optional voice**: Extra `.docx` / `.txt` under `data/voice/` are chunked and embedded the same way; draft prompts include “voice” evidence so cadence can track your samples.
- **Editor UI**: Vite + React front end; local **HTTP API** (`server/editor-server.ts`, default port **8787**) runs ingest, embed, draft, audit, and save routes. **Style audit** flow: model produces a report → optional **parse pairs** → literal replace or **model merge** on the draft text.

### Repo layout

| Area | Role |
| ---- | ---- |
| `src/` | React UI |
| `pipeline/` | Chunking, embeddings, retrieval, drafting, audit |
| `cli/` | Same pipeline from the command line |
| `server/` | Local API used by the browser |

Module layout and pipeline ordering: [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

### Defaults worth knowing

- Embeddings: **`text-embedding-3-small`**
- Optional **`models.reasoningEffort`** in `pipeline.config.json`: `none` | `low` | `medium` | `high` | `xhigh`
- Generated index files: `data/index/chunks.json`, `embeddings.json`, `topic-history.json` (recreated by ingest / embed; large repos can produce very large files)

### Other AI providers (e.g. Claude)

The default build uses **OpenAI** for both **embeddings** and **chat** (see `pipeline/openai-client.ts` and embedding call sites). **Anthropic Claude** (or another vendor) is **not** a drop-in setting yet. Swapping providers means adapting those clients and keeping retrieval compatible with however you embed text. Fine for a Cursor / Claude Code pass or a small PR; not required for normal use.
