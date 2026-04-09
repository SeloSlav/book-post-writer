# Manuscript topic lab — pipeline architecture

This repo has a Vite + React shell and a separate **Node pipeline** (TypeScript under `pipeline/` and `cli/`) that turns local `.docx` manuscripts plus optional voice samples into a finished plain-text draft (`post-*.txt`, legacy `substack-*.txt`) from **editor-supplied topic prompts** (the model writes the public title in the draft).

## Execution order

Run these in order the first time, or use `npm run full -- --prompt "…"`.

1. **`npm run ingest`** (all) or **`npm run ingest:books`** / **`npm run ingest:voice`**  
   **Books-only** and **voice-only** ingests merge into the same `chunks.json` so you can refresh long manuscripts or short voice samples independently. **Ingest all** rescans both (slow on large series). Voice accepts `.docx` and `.txt` under `paths.voice`; `README.txt` is skipped.

2. **`npm run embed`**  
   Calls the OpenAI embeddings API for each chunk, then writes `data/index/embeddings.json` (chunk id → vector). If you change the embedding model in config, the embed step clears old vectors and recomputes.

3. **`npm run draft`**  
   Requires `--prompt` with freeform topic ideas (browser UI sends the same as `customTopicPrompt`). Retrieves book and voice evidence, runs outline → draft → voice revision → style audit → CTA, appends a history line, and writes a timestamped `.txt` under `data/output/`.

4. **`npm run full`**  
   Runs ingest, embed, and draft in sequence; **`--prompt` is required**.

## Module map

| Area | Files | Role |
|------|--------|------|
| Config | `pipeline/config.ts`, optional `pipeline.config.json`, optional `PIPELINE_BOOKS` in `.env` | Models, paths (books/voice/output/index), chunk sizes, spoiler defaults |
| Schema | `pipeline/schema.ts` | Zod types for chunks, index files, scored-topic shape for drafts, config |
| Docx | `pipeline/docx.ts` | Mammoth raw text extraction |
| Chunking | `pipeline/chunker.ts` | Paragraph and length-aware splits, overlap, chapter hints |
| Metadata | `pipeline/metadata.ts` | Book name from filename, light theme hints, spoiler bump heuristics |
| Ingest | `pipeline/ingest.ts` | Glob `.docx`, orchestrate parse → chunk → tag |
| Embeddings | `pipeline/embeddings.ts`, `pipeline/openai-client.ts` | OpenAI embedding batches |
| Storage | `pipeline/storage.ts` | Read/write `chunks.json`, `embeddings.json`, topic history |
| Retrieval | `pipeline/retrieve.ts` | Cosine similarity, lexical brief overlap, filters (`source_type`, `spoiler_level_max`) |
| Draft | `pipeline/draft.ts`, `pipeline/prompts.ts` | Retrieval-grounded outline, draft, revision, JSON style audit, CTA |
| CLI | `cli/*.ts` | Thin entrypoints; load dotenv, call the above |

## Design choices (v1)

- **Local JSON index** instead of a database: easy to inspect, delete, and re-run.
- **Stable chunk ids** from hash of source path, index, and text prefix so embeddings can be reused across runs until ingest changes text or slicing.
- **Spoiler handling**: chunks carry `spoiler_level`; draft retrieval caps evidence by the topic’s `spoiler_risk`.
- **Voice fit** with no voice files: scorer uses a middling default so the pipeline still runs.

## Extension hooks

- Swap storage in `pipeline/storage.ts` for SQLite or LanceDB later without changing CLI.
- Add an LLM metadata pass in ingest (characters/themes) by enriching `pipeline/metadata.ts`.
