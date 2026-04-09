import fs from "node:fs/promises";
import path from "node:path";
import {
  EmbeddingsFileSchema,
  IndexFileSchema,
  TopicHistorySchema,
  type EmbeddingsFile,
  type IndexFile,
  type TopicHistory,
} from "./schema.js";

export const INDEX_CHUNKS = "chunks.json";
export const INDEX_EMBEDDINGS = "embeddings.json";
export const TOPIC_HISTORY = "topic-history.json";

export async function readIndex(indexDir: string): Promise<IndexFile> {
  const p = path.join(indexDir, INDEX_CHUNKS);
  const raw = JSON.parse(await fs.readFile(p, "utf8"));
  return IndexFileSchema.parse(raw);
}

export async function writeIndex(indexDir: string, data: IndexFile): Promise<void> {
  await fs.mkdir(indexDir, { recursive: true });
  const p = path.join(indexDir, INDEX_CHUNKS);
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

export async function readEmbeddings(indexDir: string): Promise<EmbeddingsFile> {
  const p = path.join(indexDir, INDEX_EMBEDDINGS);
  try {
    const raw = JSON.parse(await fs.readFile(p, "utf8"));
    return EmbeddingsFileSchema.parse(raw);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { version: 1, model: "", vectors: {} };
    }
    throw e;
  }
}

export async function writeEmbeddings(
  indexDir: string,
  model: string,
  vectors: Record<string, number[]>,
): Promise<void> {
  await fs.mkdir(indexDir, { recursive: true });
  const payload: EmbeddingsFile = { version: 1, model, vectors };
  const p = path.join(indexDir, INDEX_EMBEDDINGS);
  await fs.writeFile(p, JSON.stringify(payload, null, 2), "utf8");
}

export async function readTopicHistory(indexDir: string): Promise<TopicHistory> {
  const p = path.join(indexDir, TOPIC_HISTORY);
  try {
    const raw = JSON.parse(await fs.readFile(p, "utf8"));
    return TopicHistorySchema.parse(raw);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { titles: [] };
    throw e;
  }
}

/** Drop embedding rows for chunk ids no longer in the index (after voice-only or book-only re-ingest). */
export async function pruneEmbeddingsToMatchIndex(indexDir: string): Promise<number> {
  const index = await readIndex(indexDir);
  const emb = await readEmbeddings(indexDir);
  const ids = new Set(index.chunks.map((c) => c.id));
  const next: Record<string, number[]> = {};
  for (const id of Object.keys(emb.vectors)) {
    if (ids.has(id)) next[id] = emb.vectors[id]!;
  }
  const removed = Object.keys(emb.vectors).length - Object.keys(next).length;
  if (removed > 0) {
    await writeEmbeddings(indexDir, emb.model || "", next);
  }
  return removed;
}

export async function appendTopicHistory(
  indexDir: string,
  titles: string[],
): Promise<void> {
  const cur = await readTopicHistory(indexDir);
  const merged = new Set([...cur.titles, ...titles]);
  const next: TopicHistory = { titles: [...merged] };
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(
    path.join(indexDir, TOPIC_HISTORY),
    JSON.stringify(next, null, 2),
    "utf8",
  );
}
