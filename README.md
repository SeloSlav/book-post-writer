# Book Post Writer

## Contents

- [For writers who’d rather be writing than fighting software 📚](#for-writers)
- [You don’t have to be “good with computers” ✨](#good-with-computers)
- [Quick start (about five minutes)](#quick-start)
  - [Install Node.js and open a terminal (Windows & Mac)](#install-nodejs-and-terminal)
- [“API key” in human words 🔑](#api-key-in-human-words)
  - [Where to get API keys (pick one path to start)](#where-to-get-api-keys)
  - [Cloud vs “open” / local setups](#cloud-vs-open-local)
- [What you get (plain English)](#what-you-get)
- [Prerequisites](#prerequisites)
- [Setup details](#setup-details)
  - [Where your books live](#where-your-books-live)
  - [Models (defaults and overrides)](#models-defaults-and-overrides)
- [Walkthrough: from `.docx` to a post](#walkthrough-from-docx-to-post)
- [Folder cheat sheet](#folder-cheat-sheet)
- [Commands reference](#commands-reference)
  - [Two terminals instead of `npm run dev`](#two-terminals-instead-of-npm-run-dev)
  - [CLI examples](#cli-examples)
  - [Browser UI notes](#browser-ui-notes)
- [When something goes wrong](#when-something-goes-wrong)
- [Technical details](#technical-details)
  - [What happens under the hood](#what-happens-under-the-hood)
  - [Repo layout](#repo-layout)
  - [Defaults worth knowing](#defaults-worth-knowing)
  - [Other AI providers (e.g. Claude)](#other-ai-providers)

---

### <span id="for-writers">For writers who’d rather be writing than fighting software 📚</span>

If you have **Word manuscripts** and need **newsletter posts, threads, or essays** that still sound like *your* story (not a generic chatbot essay), this tool is for you. You describe the idea; it drafts text you can edit. **No publishing platform is required:** you get plain files you can paste anywhere.

---

### <span id="good-with-computers">You don’t have to be “good with computers” ✨</span>

- **Never used GitHub?** That’s normal. Think of it as a **safe download page** for this project: you click **Code → Download ZIP**, unzip the folder, and follow the steps below. You are not “joining a club.” You’re just grabbing a copy of the app, like saving a file from email. (If you *do* use Git, clone works too, same result.)
- **Your books stay on your machine.** The app reads your `.docx` files from a folder **you** choose. We’re not running a website that stores your novels in the cloud.
- **This app is free and open source.** The part that *writes* text for you is an outside AI service. You will paste a **secret code** (called an **API key**) into a file on your computer so only *your* account is charged when *you* run a draft. **Quick start** below gets you running; [**“API key” in human words**](#api-key-in-human-words) right after that explains the same idea in more detail if the jargon worries you.

---

## <span id="quick-start">Quick start (about five minutes)</span>

### <span id="install-nodejs-and-terminal">Install Node.js and open a terminal (Windows & Mac)</span>

Do this section once. If you already installed Node.js in the past, skip to **Check that it worked**, then jump to step 1 under **Then run these commands**.

**What is Node.js?** A free program that lets your computer run Book Post Writer. You are not “coding”; you are just installing the same engine many modern apps use.

#### Download and install Node.js

1. Open **[nodejs.org](https://nodejs.org/)** in your browser.
2. Download the **LTS** (“Long Term Support”) installer, not the bleeding-edge one.
3. **Windows:** Run the `.msi` file. Click **Next** through the screens and accept the defaults (including **Add to PATH** if you see it). When it finishes, **close any PowerShell or Command Prompt windows you had open** and open a fresh one so they see Node.
4. **Mac:** Run the `.pkg` file and click through the installer. Alternatively, if someone already set you up with **Homebrew**, you can use `brew install node` in Terminal (optional; the website installer is enough).

#### Which window do I type commands in?

- **Windows:** Use **PowerShell** (recommended) or **Command Prompt**. Easiest way: press the **Windows key**, type **`PowerShell`**, press **Enter**. (For Command Prompt, search **`cmd`** instead.) Either works for every command in this README.
- **Mac:** Open **Terminal**: press **Cmd + Space**, type **`Terminal`**, press **Enter**.
- **Linux:** Open your usual **Terminal** application.

That black or blue window is normal. You type one line, press **Enter**, wait for it to finish, then type the next.

#### Check that it worked

In that same window, type **`node -v`** and press **Enter**. You should see something like `v22.3.0`. You want **v20 or higher**.

Then type **`npm -v`** and press **Enter**. You should see another version number.

If either command says **not recognized**, **command not found**, or similar, Node is not on your PATH yet: restart the computer once, or reinstall Node and make sure you used the default options. On Windows, open a **new** PowerShell window after installing.

#### Get “into” the Book Post Writer folder

Commands like `npm install` only work when the terminal is **inside** the folder you unzipped (the one that contains **`package.json`**).

- **Windows (File Explorer + PowerShell):** In File Explorer, open the Book Post Writer folder. Click the **address bar** at the top, press **Ctrl + C** to copy the path. In PowerShell, type **`cd `** (cd, then a space), **right-click** to paste the path, press **Enter**.
- **Mac (Finder + Terminal):** In Terminal, type **`cd `** (cd, then a space). **Drag the Book Post Writer folder** from Finder into the Terminal window (it drops the full path). Press **Enter**.

If you are in the right place, typing **`dir`** (Windows) or **`ls`** (Mac / Linux) should list files including **`package.json`**.

---

#### Then run these commands

1. **Install dependencies** (still in that same folder): run:
   ```bash
   npm install
   ```
   Wait until it finishes. You should see no red “ERR!” lines at the end.
2. **Connect OpenAI (the step writers often pause on)**  
   If **“API key”** sounds like nonsense, you are in good company. Before you paste anything, read [**“API key” in human words**](#api-key-in-human-words) **(the section right below Quick start)**. It is short: what that code is, that your books are not uploaded to us, rough cost, and where to click on OpenAI’s site.  
   When you are ready, create a key at [OpenAI API keys](https://platform.openai.com/api-keys), then wire it into this project:
   - **Windows (Command Prompt):** `copy .env.example .env`
   - **Windows (PowerShell):** `Copy-Item .env.example .env`
   - **macOS / Linux:** `cp .env.example .env`  
   Then open `.env` in Notepad, TextEdit, or your editor and set `OPENAI_API_KEY` to your key (no quotes).
3. **Manuscripts**: Put your book `.docx` files in `data/books/`, *or* point the app elsewhere (see [Where your books live](#where-your-books-live) below).
4. **Run the app**: `npm run dev`, then open the URL the terminal prints (often [http://localhost:5173](http://localhost:5173)).
5. **First draft**: In the **Load your books, then generate a post** section: **Scan my Word books (.docx)** → **Connect sources to the writer** → describe the post in the topic box → **Write draft post** (or **Do all steps automatically (slow)**). Your draft appears in **Your post draft** on the left and is saved under `data/output/` as `post-*.txt`.

That is the whole happy path. The next section, **“API key” in human words**, is there if you want a calmer explanation of step 2 (or if you skipped ahead). After that, **What you get** summarizes features, then the rest covers options, the command line, and troubleshooting.

---

## <span id="api-key-in-human-words">“API key” in human words 🔑</span>

An **API key** is like a **password that only lets the AI bill *your* account** when *you* click “write draft.” You create it on the provider’s site and paste it into the **`.env`** file in this project (that is **Quick start**, step 2, above).

**Reading order:** You can do **Quick start** first and treat this section as the “why and where” appendix, or read this section before step 2 if you like to understand the pieces before you click anything.

### <span id="where-to-get-api-keys">Where to get API keys (pick one path to start)</span>

| If you want… | Get a key here | Notes |
| ------------ | -------------- | ----- |
| **OpenAI** (what this repo uses out of the box) | [OpenAI API keys](https://platform.openai.com/api-keys) | Needs [OpenAI](https://platform.openai.com/) account; [usage pricing](https://openai.com/api/pricing/) is on their site. |
| **Anthropic (Claude)** | [Anthropic Console](https://console.anthropic.com/) | Wiring into *this* codebase is DIY today; see [Technical details](#technical-details). |
| **Many models, one dashboard** | [OpenRouter API keys](https://openrouter.ai/keys) | Useful if you like to experiment; still requires code changes to use here. |

### <span id="cloud-vs-open-local">Cloud vs “open” / local setups</span>

- **Paid cloud APIs** (OpenAI, Anthropic, etc.): you register, add a payment method if required, create a key, paste it into `.env`. No key is stored by us; it never leaves your machine except when the app calls the provider.
- **Open-source / self-hosted direction:** tools like **[Ollama](https://ollama.com/)** or **[LM Studio](https://lmstudio.ai/)** let you run models **on your own computer** with **no per-token bill** to a big vendor (your hardware does the work). This repo does **not** ship a one-click Ollama mode yet; hooking it up means developer work (same bucket as “use Claude instead”: small codebase, but you or Cursor / Claude Code would adapt the API calls).

**This version of the app is set up for OpenAI first** (create an account, add billing if prompted, copy a key into `.env`; **Quick start** step 2 walks through the file part).

**Prefer Claude, OpenRouter, or a local model?** The project is open source; if you use **Cursor**, **Claude Code**, or a developer friend, swapping or adding another backend is doable. It’s **not** a one-click switch today, but you’re not locked into a black box.

---

## <span id="what-you-get">What you get (plain English)</span>

- **Load your books** 📂: One manuscript or a whole series of Word files in a folder. Nothing gets “uploaded” to us; the app reads from your disk.
- **Describe the post, not the headline** ✍️: A short note: themes, questions, which characters or ideas matter. You get a **text file** you can copy into Substack, Mailchimp, Notes, wherever.
- **Optional: match your voice** 🎙️: Drop in samples of writing you’ve already published so drafts feel closer to how you usually sound.
- **Edit on screen** 🖥️: Buttons spell out what they do. Get suggestions, accept changes line by line or rewrite the whole draft, then **save** when it looks right.

---

## <span id="prerequisites">Prerequisites</span>

| You need | Why |
| -------- | --- |
| **Node.js 20+** | Runs the app, pipeline, and local API. Step-by-step install: [Install Node.js and open a terminal](#install-nodejs-and-terminal). |
| **OpenAI API key** (for default setup) | Chat and embeddings (billing is on your OpenAI account). [Get a key](https://platform.openai.com/api-keys). |

---

## <span id="setup-details">Setup details</span>

The npm package name is **`book-post-writer`**. If your folder name differs, you can rename the folder when nothing has it open (close the editor first).

**Optional config file**: For models, paths, and draft tuning, copy the example and edit:

```bash
copy pipeline.config.example.json pipeline.config.json
```

(On macOS/Linux use `cp` instead of `copy`.)

### <span id="where-your-books-live">Where your books live</span>

The pipeline looks for `.docx` files in the folder set by:

- **`paths.books`** in `pipeline.config.json` (path **relative to the repo root**, e.g. `data/books`, or an **absolute** path on your computer), **or**
- **`PIPELINE_BOOKS`** in `.env` overrides `paths.books` if set (handy on Windows, e.g. `PIPELINE_BOOKS=C:\MyNovels\Series`).

The UI status line shows which path the API is actually using.

**Draft tuning (optional)**: In `pipeline.config.json`, under `draft`:

- **`minWordCount`**: Minimum length of the essay *body* (title block not counted). Default **1100**; tweak if you want shorter or longer pieces (about 1000 to 1200+ words is a common range).
- **`voiceEvidenceK`**: How many “voice” chunks go into the draft (similarity + spread across sample files). Raise it if you have large voice archives and want more cadence signal. Default **16**.

### <span id="models-defaults-and-overrides">Models (defaults and overrides)</span>

- Default chat model: **`gpt-5.4`**. Optional **`models.reasoningEffort`**: `none`, `low`, `medium`, `high`, `xhigh`.
- Embeddings: **`text-embedding-3-small`**.
- If your key cannot use the default chat model, set **`models.chat`** in `pipeline.config.json` to another model id your account supports.

---

## <span id="walkthrough-from-docx-to-post">Walkthrough: from `.docx` to a post</span>

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

## <span id="folder-cheat-sheet">Folder cheat sheet</span>

| Folder | Purpose |
| ------ | ------- |
| `data/books/` | Your manuscript `.docx` files (main source for the essay). |
| `data/voice/` | Optional writing samples for voice-matching. |
| `data/index/` | Generated `chunks.json`, `embeddings.json`, `topic-history.json`. |
| `data/output/` | Timestamped draft `.txt` files. |

More tips: `data/books/README.txt` and `data/voice/README.txt`.

---

## <span id="commands-reference">Commands reference</span>

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

### <span id="two-terminals-instead-of-npm-run-dev">Two terminals instead of `npm run dev`</span>

- Terminal 1: `npm run editor-api`
- Terminal 2: `npm run dev:vite`

### <span id="cli-examples">CLI examples</span>

```bash
npx tsx cli/draft.ts --prompt "Topic ideas: themes, books, claims, not the final headline"
```

```bash
npx tsx cli/full.ts --prompt "Same kind of topic ideas as for draft"
```

### <span id="browser-ui-notes">Browser UI notes</span>

Open the Vite URL (often [http://localhost:5173](http://localhost:5173)). **Your post draft** (left) is plain text, the same content as `post-*.txt`. **Get writing suggestions**, **Apply checked changes to draft**, and **Rewrite whole draft with AI** work on that text. The API reads `OPENAI_API_KEY` and `pipeline.config.json` from the **repo root**. Draft and full pipeline requests need a topic field (`customTopicPrompt` in the API). The UI wires this for you.

---

## <span id="when-something-goes-wrong">When something goes wrong</span>

| Symptom | Things to check |
| ------- | ---------------- |
| **`node` or `npm` is not recognized** | Node is missing or the terminal was opened before you installed it. Follow [Install Node.js and open a terminal](#install-nodejs-and-terminal), then open a **new** PowerShell / Terminal window. |
| **`npm install` fails or says no `package.json`** | You are not inside the Book Post Writer folder. `cd` there first (see [Get “into” the Book Post Writer folder](#install-nodejs-and-terminal)). |
| Errors about API key | `OPENAI_API_KEY` is set in `.env` at the repo root; restart `npm run dev` after changes. Confirm the key at [OpenAI API keys](https://platform.openai.com/api-keys). |
| Empty or useless drafts | At least one `.docx` in your books folder; scan sources then **Connect sources to the writer** before **Write draft post**. |
| CLI exits non-zero | Usually missing key, missing book files, or missing embeddings before `draft` / `full`. Messages are short on purpose. Read the last line. |
| Voice folder empty | Ingest does **not** fail if `data/voice/` is empty; voice is optional. |
| Port already in use | Another app may be on 5173 or 8787; stop it or adjust Vite / server config if you have customized ports. |

---

## <span id="technical-details">Technical details</span>

*For developers, tinkerers, and anyone who likes the full picture.*

### <span id="what-happens-under-the-hood">What happens under the hood</span>

- **Ingest & index**: Manuscripts are read from disk, split into chunks, and indexed with **OpenAI embeddings** so retrieval can pull relevant passages for a given topic.
- **Generate / draft**: A chat model (default **`gpt-5.4`**) writes a plain-text post using retrieved evidence from your books (and optional voice samples). You supply a **topic brief**; the model proposes **title and subtitle** plus body. Output is timestamped `.txt` under `data/output/`.
- **Optional voice**: Extra `.docx` / `.txt` under `data/voice/` are chunked and embedded the same way; draft prompts include “voice” evidence so cadence can track your samples.
- **Editor UI**: Vite + React front end; local **HTTP API** (`server/editor-server.ts`, default port **8787**) runs ingest, embed, draft, audit, and save routes. **Style audit** flow: model produces a report → optional **parse pairs** → literal replace or **model merge** on the draft text.

### <span id="repo-layout">Repo layout</span>

| Area | Role |
| ---- | ---- |
| `src/` | React UI |
| `pipeline/` | Chunking, embeddings, retrieval, drafting, audit |
| `cli/` | Same pipeline from the command line |
| `server/` | Local API used by the browser |

Module layout and pipeline ordering: [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

### <span id="defaults-worth-knowing">Defaults worth knowing</span>

- Embeddings: **`text-embedding-3-small`**
- Optional **`models.reasoningEffort`** in `pipeline.config.json`: `none` | `low` | `medium` | `high` | `xhigh`
- Generated index files: `data/index/chunks.json`, `embeddings.json`, `topic-history.json` (recreated by ingest / embed; large repos can produce very large files)

### <span id="other-ai-providers">Other AI providers (e.g. Claude)</span>

The default build uses **OpenAI** for both **embeddings** and **chat** (see `pipeline/openai-client.ts` and embedding call sites). **Anthropic Claude** (or another vendor) is **not** a drop-in setting yet. Swapping providers means adapting those clients and keeping retrieval compatible with however you embed text. Fine for a Cursor / Claude Code pass or a small PR; not required for normal use.
