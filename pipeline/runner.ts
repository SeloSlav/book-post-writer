import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { generatePost } from "./draft.js";
import { embedChunks } from "./embeddings.js";
import {
  collectDocxFiles,
  collectVoiceFolderFiles,
  ingestSourceFolder,
} from "./ingest.js";
import { getOpenAI } from "./openai-client.js";
import {
  EDITOR_SUPPLIED_BRIEF_TOPIC_TITLE,
  IndexFileSchema,
  type ScoredTopic,
  type SpoilerLevel,
  type TextChunk,
} from "./schema.js";
import { logPipeline } from "./progress-log.js";
import {
  appendTopicHistory,
  pruneEmbeddingsToMatchIndex,
  readEmbeddings,
  readIndex,
  writeEmbeddings,
  writeIndex,
} from "./storage.js";

export type IngestResult = {
  bookChunks: number;
  voiceChunks: number;
  indexDir: string;
};

async function tryReadChunksBySource(
  indexDir: string,
  source: "book" | "voice",
): Promise<TextChunk[]> {
  try {
    const idx = await readIndex(indexDir);
    return idx.chunks.filter((c) => c.metadata.source_type === source);
  } catch {
    return [];
  }
}

/** Re-scan manuscripts only; keeps existing voice chunks in the index. Prunes orphan embeddings. */
export async function pipelineIngestBooksOnly(): Promise<IngestResult> {
  const cfg = loadConfig();
  const existingVoice = await tryReadChunksBySource(cfg.paths.indexDir, "voice");
  logPipeline(
    `Ingest books: scanning ${cfg.paths.books} (keeping ${existingVoice.length} voice chunk(s) from index)…`,
  );
  const bookChunks = await ingestSourceFolder({
    rootDir: cfg.paths.books,
    source_type: "book",
    spoilerDefault: cfg.spoilerDefaults.book,
    chunk: cfg.chunk,
  });
  logPipeline(`Ingest books: ${bookChunks.length} book chunk(s) from .docx`);
  const chunks = [...bookChunks, ...existingVoice];
  logPipeline(`Ingest books: writing ${chunks.length} total chunks → ${cfg.paths.indexDir}`);
  const payload = IndexFileSchema.parse({
    version: 1,
    created_at: new Date().toISOString(),
    chunks,
  });
  await writeIndex(cfg.paths.indexDir, payload);
  await fs.writeFile(
    path.join(cfg.paths.indexDir, "books-root.txt"),
    path.resolve(cfg.paths.books),
    "utf8",
  );
  const pruned = await pruneEmbeddingsToMatchIndex(cfg.paths.indexDir);
  if (pruned > 0) logPipeline(`Ingest books: pruned ${pruned} orphan embedding(s).`);
  logPipeline(`Ingest books: done.`);
  return {
    bookChunks: bookChunks.length,
    voiceChunks: existingVoice.length,
    indexDir: cfg.paths.indexDir,
  };
}

/** Re-scan voice folder only; keeps existing book chunks. Prunes orphan embeddings. */
export async function pipelineIngestVoiceOnly(): Promise<IngestResult> {
  const cfg = loadConfig();
  const existingBooks = await tryReadChunksBySource(cfg.paths.indexDir, "book");
  if (existingBooks.length === 0) {
    throw new Error(
      "No book chunks in index. Run “Ingest books” (or full “Ingest all”) first so manuscripts are indexed.",
    );
  }
  logPipeline(`Ingest voice: keeping ${existingBooks.length} book chunk(s) from index.`);
  const voiceRoot = cfg.paths.voice;
  const voicePresent = await fs
    .access(voiceRoot)
    .then(() => true)
    .catch(() => false);
  if (!voicePresent) {
    logPipeline(
      `Ingest voice: folder missing at ${voiceRoot} — fix paths.voice in config or create the folder.`,
    );
  } else {
    const listed = await collectVoiceFolderFiles(voiceRoot);
    logPipeline(
      `Ingest voice: ${voiceRoot} — ${listed.length} source file(s) (.docx/.txt, README.txt excluded).`,
    );
  }
  const voiceChunks = await ingestSourceFolder({
    rootDir: voiceRoot,
    source_type: "voice",
    spoilerDefault: cfg.spoilerDefaults.voice,
    chunk: cfg.chunk,
    allowEmpty: true,
  });
  logPipeline(`Ingest voice: ${voiceChunks.length} voice chunk(s) after chunking.`);
  if (voiceChunks.length === 0 && voicePresent) {
    logPipeline(
      `Ingest voice: warning — no chunks produced. Check that .txt/.docx files are under ${voiceRoot}.`,
    );
  }
  const chunks = [...existingBooks, ...voiceChunks];
  logPipeline(`Ingest voice: writing ${chunks.length} total chunks → ${cfg.paths.indexDir}`);
  const payload = IndexFileSchema.parse({
    version: 1,
    created_at: new Date().toISOString(),
    chunks,
  });
  await writeIndex(cfg.paths.indexDir, payload);
  const pruned = await pruneEmbeddingsToMatchIndex(cfg.paths.indexDir);
  if (pruned > 0) logPipeline(`Ingest voice: pruned ${pruned} orphan embedding(s).`);
  logPipeline(`Ingest voice: done.`);
  return {
    bookChunks: existingBooks.length,
    voiceChunks: voiceChunks.length,
    indexDir: cfg.paths.indexDir,
  };
}

/** Full re-ingest: all books + all voice (slow on large corpora). Prefer ingest-books / ingest-voice for routine updates. */
export async function pipelineIngest(): Promise<IngestResult> {
  const cfg = loadConfig();
  logPipeline(`Ingest all: scanning books folder (local disk, no API): ${cfg.paths.books}`);
  const bookChunks = await ingestSourceFolder({
    rootDir: cfg.paths.books,
    source_type: "book",
    spoilerDefault: cfg.spoilerDefaults.book,
    chunk: cfg.chunk,
  });
  logPipeline(`Ingest all: ${bookChunks.length} book chunk(s) from .docx`);
  logPipeline(`Ingest all: scanning voice folder: ${cfg.paths.voice}`);
  const voiceRoot = cfg.paths.voice;
  const voicePresent = await fs
    .access(voiceRoot)
    .then(() => true)
    .catch(() => false);
  if (!voicePresent) {
    logPipeline(
      `Ingest all: voice folder missing at ${voiceRoot} — 0 voice chunks (create it or fix paths.voice).`,
    );
  } else {
    const listed = await collectVoiceFolderFiles(voiceRoot);
    logPipeline(
      `Ingest all: voice folder — found ${listed.length} source file(s) (.docx/.txt, README.txt excluded).`,
    );
  }
  const voiceChunks = await ingestSourceFolder({
    rootDir: voiceRoot,
    source_type: "voice",
    spoilerDefault: cfg.spoilerDefaults.voice,
    chunk: cfg.chunk,
    allowEmpty: true,
  });
  logPipeline(`Ingest all: ${voiceChunks.length} voice chunk(s) after chunking`);
  const chunks = [...bookChunks, ...voiceChunks];
  logPipeline(`Ingest all: writing ${chunks.length} total chunks → ${cfg.paths.indexDir}`);
  const payload = IndexFileSchema.parse({
    version: 1,
    created_at: new Date().toISOString(),
    chunks,
  });
  await writeIndex(cfg.paths.indexDir, payload);
  await fs.writeFile(
    path.join(cfg.paths.indexDir, "books-root.txt"),
    path.resolve(cfg.paths.books),
    "utf8",
  );
  const pruned = await pruneEmbeddingsToMatchIndex(cfg.paths.indexDir);
  if (pruned > 0) logPipeline(`Ingest all: pruned ${pruned} orphan embedding(s).`);
  logPipeline(`Ingest all: done.`);
  return {
    bookChunks: bookChunks.length,
    voiceChunks: voiceChunks.length,
    indexDir: cfg.paths.indexDir,
  };
}

export type EmbedResult = {
  vectorCount: number;
  model: string;
};

export async function pipelineEmbed(): Promise<EmbedResult> {
  const cfg = loadConfig();
  logPipeline(
    `Embed: loading index (${cfg.paths.indexDir}) — OpenAI embeddings, often the slowest step`,
  );
  const client = getOpenAI();
  const index = await readIndex(cfg.paths.indexDir);
  const prev = await readEmbeddings(cfg.paths.indexDir);
  if (prev.model && prev.model !== cfg.models.embedding && Object.keys(prev.vectors).length) {
    logPipeline(
      `Embed: embedding model changed → clearing cached vectors, re-embedding everything`,
    );
    prev.vectors = {};
  }
  const already = Object.keys(prev.vectors).length;
  const need = index.chunks.filter((c) => !prev.vectors[c.id]).length;
  logPipeline(
    `Embed: ${index.chunks.length} chunk(s) in index; ${already} already embedded; ${need} to request from API`,
  );
  const vectors = await embedChunks(client, cfg, index.chunks, prev.vectors);
  logPipeline(`Embed: writing ${Object.keys(vectors).length} vector(s) to disk…`);
  await writeEmbeddings(cfg.paths.indexDir, cfg.models.embedding, vectors);
  logPipeline(`Embed: done (${cfg.models.embedding}).`);
  return {
    vectorCount: Object.keys(vectors).length,
    model: cfg.models.embedding,
  };
}

function slugFromIdeaText(s: string): string {
  const t = s.replace(/[^\w\s-]/g, "").trim().slice(0, 60);
  return t.replace(/\s+/g, "-") || "post";
}

/** Build a scored topic from freeform user text (UI / API). Title/headline are authored in the draft, not taken from the first line here. */
export function scoredTopicFromManualPrompt(
  prompt: string,
  spoilerDefault: SpoilerLevel,
): ScoredTopic {
  const thesis = prompt.trim();
  const angle =
    "Invent the public title and optional subtitle when you write the post. The brief is ideas and coverage only — not headline copy unless it is already polished headline language.";
  return {
    title: EDITOR_SUPPLIED_BRIEF_TOPIC_TITLE,
    thesis,
    angle,
    primary_books: [],
    spoiler_risk: spoilerDefault,
    scores: {
      evidence: 0.5,
      voice_fit: 0.5,
      spoiler_safety: 0.5,
      novelty: 1,
      total: 0.5,
    },
  };
}

export type DraftResult = {
  filePath: string;
  topicTitle: string;
  /** Plain post body (+ CTA); same bytes written to disk as UTF-8 `.txt`. */
  text: string;
};

export async function pipelineDraft(params: {
  customTopicPrompt: string;
}): Promise<DraftResult> {
  const cfg = loadConfig();
  logPipeline(`Draft: loading corpus…`);
  const client = getOpenAI();
  const index = await readIndex(cfg.paths.indexDir);
  const emb = await readEmbeddings(cfg.paths.indexDir);
  const bookChunks = index.chunks.filter((c) => c.metadata.source_type === "book");
  const voiceChunks = index.chunks.filter((c) => c.metadata.source_type === "voice");
  if (bookChunks.some((c) => !emb.vectors[c.id])) {
    throw new Error("Missing embeddings. Run embed first.");
  }
  if (bookChunks.length === 0) {
    throw new Error("No book chunks in index. Run ingest first.");
  }

  const manual = params.customTopicPrompt.trim();
  if (manual.length < 12) {
    throw new Error("Topic ideas are required (at least 12 characters).");
  }
  const topic = scoredTopicFromManualPrompt(manual, cfg.spoilerDefaults.book);
  const preview = manual.slice(0, 140).replace(/\s+/g, " ");
  logPipeline(`Draft: using your topic ideas (${manual.length} chars) — preview: ${preview}${manual.length > 140 ? "…" : ""}`);
  const logLabel = `${manual.slice(0, 72)}${manual.length > 72 ? "…" : ""}`;
  logPipeline(
    `Draft: generating post for "${logLabel}" (outline → draft → revision → 2-pass style audit → CTA; several minutes)…`,
  );
  const result = await generatePost({
    client,
    cfg,
    topic,
    bookChunks,
    voiceChunks,
    vectors: emb.vectors,
  });
  await fs.mkdir(cfg.paths.output, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTitle = slugFromIdeaText(manual);
  const outName = `post-${stamp}-${safeTitle}.txt`;
  const outPath = path.join(cfg.paths.output, outName);
  const text = [result.audited_markdown.trim(), "", result.cta, ""].join("\n");
  await fs.writeFile(outPath, text, "utf8");
  await appendTopicHistory(cfg.paths.indexDir, [manual.slice(0, 200)]);
  logPipeline(`Draft: wrote ${outPath}`);
  return { filePath: outPath, topicTitle: manual.slice(0, 120), text };
}

export type PipelineStatus = {
  booksPath: string;
  bookFileCount: number;
  bookGroups: Array<{ name: string; count: number }>;
  voiceFileCount: number;
  chunkCount: number;
  embeddedCount: number;
  sourcesNeedScan: boolean;
  embeddingsNeedRefresh: boolean;
  apiKeyConfigured: boolean;
  chatModel: string;
  latestDraftPath: string | null;
  outputDir: string;
};

async function sourceFilesIn(
  dir: string,
  source: "book" | "voice",
): Promise<{ count: number; newestMtime: number; files: string[] }> {
  try {
    const files =
      source === "book"
        ? await collectDocxFiles(dir)
        : await collectVoiceFolderFiles(dir);
    const mtimes = await Promise.all(
      files.map((file) => fs.stat(file).then((stat) => stat.mtimeMs)),
    );
    return { count: files.length, newestMtime: Math.max(0, ...mtimes), files };
  } catch {
    return { count: 0, newestMtime: 0, files: [] };
  }
}

function groupBookFiles(rootDir: string, files: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const relative = path.relative(rootDir, file);
    const parts = relative.split(path.sep).filter(Boolean);
    const group = parts.length > 1 ? parts[0]! : "Unsorted";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === "Unsorted" ? 1 : b.name === "Unsorted" ? -1 : a.name.localeCompare(b.name)));
}

async function modifiedAt(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const cfg = loadConfig();
  const [books, voice] = await Promise.all([
    sourceFilesIn(cfg.paths.books, "book"),
    sourceFilesIn(cfg.paths.voice, "voice"),
  ]);
  let chunkCount = 0;
  let embeddedCount = 0;
  try {
    const idx = await readIndex(cfg.paths.indexDir);
    chunkCount = idx.chunks.length;
  } catch {
    chunkCount = 0;
  }
  try {
    const emb = await readEmbeddings(cfg.paths.indexDir);
    embeddedCount = Object.keys(emb.vectors).length;
  } catch {
    embeddedCount = 0;
  }
  let latestDraftPath: string | null = null;
  try {
    const names = await fs.readdir(cfg.paths.output);
    const drafts = names.filter(
      (n) =>
        (n.startsWith("post-") || n.startsWith("substack-")) &&
        (n.endsWith(".md") || n.endsWith(".txt")),
    );
    if (drafts.length > 0) {
      const stats = await Promise.all(
        drafts.map(async (n) => {
          const p = path.join(cfg.paths.output, n);
          const st = await fs.stat(p);
          return { p, mtime: st.mtimeMs };
        }),
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      latestDraftPath = stats[0]?.p ?? null;
    }
  } catch {
    latestDraftPath = null;
  }
  const chunksModifiedAt = await modifiedAt(path.join(cfg.paths.indexDir, "chunks.json"));
  const embeddingsModifiedAt = await modifiedAt(
    path.join(cfg.paths.indexDir, "embeddings.json"),
  );
  const newestSource = Math.max(books.newestMtime, voice.newestMtime);
  let indexedBooksRoot = "";
  try {
    indexedBooksRoot = (
      await fs.readFile(path.join(cfg.paths.indexDir, "books-root.txt"), "utf8")
    ).trim();
  } catch {
    indexedBooksRoot = "";
  }
  const booksRootChanged = path.resolve(indexedBooksRoot || ".") !== path.resolve(cfg.paths.books);
  const sourcesNeedScan =
    books.count > 0 &&
    (chunkCount === 0 || booksRootChanged || newestSource > chunksModifiedAt);
  const embeddingsNeedRefresh =
    chunkCount > 0 &&
    (embeddedCount < chunkCount || embeddingsModifiedAt < chunksModifiedAt);
  return {
    booksPath: cfg.paths.books,
    bookFileCount: books.count,
    bookGroups: groupBookFiles(cfg.paths.books, books.files),
    voiceFileCount: voice.count,
    chunkCount,
    embeddedCount,
    sourcesNeedScan,
    embeddingsNeedRefresh,
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    chatModel: cfg.models.chat,
    latestDraftPath,
    outputDir: cfg.paths.output,
  };
}

export async function readLatestDraft(): Promise<{
  path: string;
  content: string;
} | null> {
  const status = await getPipelineStatus();
  if (!status.latestDraftPath) return null;
  const content = await fs.readFile(status.latestDraftPath, "utf8");
  return { path: status.latestDraftPath, content };
}

export type SaveDraftStrategy = "prefer-latest" | "always-new";

/**
 * Persist editor text under configured output. prefer-latest overwrites the newest post/substack .txt if any; otherwise creates a new file (same as always-new).
 */
export async function saveEditorDraft(params: {
  text: string;
  strategy: SaveDraftStrategy;
  targetPath?: string | null;
}): Promise<{ path: string; kind: "overwrote" | "created" }> {
  const cfg = loadConfig();
  const dir = cfg.paths.output;
  await fs.mkdir(dir, { recursive: true });
  const normalized = params.text.replace(/\r\n/g, "\n");

  if (params.strategy === "prefer-latest" && params.targetPath) {
    const resolvedDir = path.resolve(dir);
    const resolvedTarget = path.resolve(params.targetPath);
    const relative = path.relative(resolvedDir, resolvedTarget);
    const isInsideOutput =
      relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
    const allowedExtension = [".txt", ".md"].includes(
      path.extname(resolvedTarget).toLowerCase(),
    );
    if (!isInsideOutput || !allowedExtension) {
      throw new Error("That draft is outside this app’s saved-drafts folder.");
    }
    await fs.writeFile(resolvedTarget, normalized, "utf8");
    logPipeline(`Save draft: overwrote ${resolvedTarget}`);
    return { path: resolvedTarget, kind: "overwrote" };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const firstLine =
    normalized
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "post";
  const slug = slugFromIdeaText(firstLine);
  const outName = `post-${stamp}-${slug}.txt`;
  const outPath = path.join(dir, outName);
  await fs.writeFile(outPath, normalized, "utf8");
  logPipeline(`Save draft: wrote ${outPath}`);
  return { path: outPath, kind: "created" };
}

export async function pipelineFull(params: {
  customTopicPrompt: string;
}): Promise<{
  ingest: IngestResult;
  embed: EmbedResult;
  draft: DraftResult;
}> {
  const t0 = Date.now();
  const manual = params.customTopicPrompt.trim();
  if (manual.length < 12) {
    throw new Error("Topic ideas are required (at least 12 characters).");
  }
  logPipeline(
    `Full pipeline: starting (1 ingest → 2 embed → 3 draft from your topic ideas). Total time often 5–15+ min with many books.`,
  );
  const ingest = await pipelineIngest();
  logPipeline(`Full pipeline: step 1/3 done in ${((Date.now() - t0) / 1000).toFixed(1)}s cumulative`);
  const embed = await pipelineEmbed();
  logPipeline(`Full pipeline: step 2/3 done in ${((Date.now() - t0) / 1000).toFixed(1)}s cumulative`);
  const draft = await pipelineDraft({ customTopicPrompt: manual });
  logPipeline(
    `Full pipeline: step 3/3 done — finished in ${((Date.now() - t0) / 1000).toFixed(1)}s total.`,
  );
  return { ingest, embed, draft };
}
