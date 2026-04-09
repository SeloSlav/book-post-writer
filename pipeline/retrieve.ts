import type { EmbeddedChunk, SourceType, SpoilerLevel } from "./schema.js";

export type RetrieveFilters = {
  source_type?: SourceType;
  spoiler_level_max?: SpoilerLevel;
};

const SPOILER_ORDER: SpoilerLevel[] = ["none", "low", "medium", "high"];

function spoilerRank(level: SpoilerLevel): number {
  return SPOILER_ORDER.indexOf(level);
}

export function retrieveBySimilarity(
  queryEmbedding: number[],
  corpus: EmbeddedChunk[],
  topK: number,
  filters: RetrieveFilters = {},
): EmbeddedChunk[] {
  const ranked = corpus
    .filter((c) => {
      if (filters.source_type && c.metadata.source_type !== filters.source_type)
        return false;
      if (filters.spoiler_level_max !== undefined) {
        if (
          spoilerRank(c.metadata.spoiler_level) >
          spoilerRank(filters.spoiler_level_max)
        ) {
          return false;
        }
      }
      return true;
    })
    .map((c) => ({
      chunk: c,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  const out: EmbeddedChunk[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    if (seen.has(row.chunk.id)) continue;
    seen.add(row.chunk.id);
    out.push(row.chunk);
    if (out.length >= topK) break;
  }
  return out;
}

/**
 * Voice snippets for drafting: half by embedding similarity to the topic, half spread across
 * source files so cadence is learned even when past posts are not about this subplot.
 */
export function retrieveVoiceChunksForDraft(
  queryEmbedding: number[],
  voiceCorpus: EmbeddedChunk[],
  topK: number,
): EmbeddedChunk[] {
  if (voiceCorpus.length === 0 || topK <= 0) return [];
  if (voiceCorpus.length <= topK) {
    return retrieveBySimilarity(queryEmbedding, voiceCorpus, topK, {});
  }

  const simCount = Math.max(2, Math.floor(topK * 0.5));
  const diverseCount = topK - simCount;

  const bySim = retrieveBySimilarity(queryEmbedding, voiceCorpus, simCount, {});
  const seen = new Set(bySim.map((c) => c.id));

  const byFile = new Map<string, EmbeddedChunk[]>();
  for (const c of voiceCorpus) {
    if (seen.has(c.id)) continue;
    const key = c.metadata.source_path;
    const arr = byFile.get(key) ?? [];
    arr.push(c);
    byFile.set(key, arr);
  }
  for (const arr of byFile.values()) {
    arr.sort((a, b) => a.metadata.chunk_index - b.metadata.chunk_index);
  }

  const diverse: EmbeddedChunk[] = [];
  const fileKeys = [...byFile.keys()].sort();
  let round = 0;
  while (diverse.length < diverseCount && fileKeys.length > 0) {
    let progressed = false;
    for (const key of fileKeys) {
      const arr = byFile.get(key)!;
      const pick = arr[round];
      if (pick && !seen.has(pick.id)) {
        diverse.push(pick);
        seen.add(pick.id);
        progressed = true;
        if (diverse.length >= diverseCount) break;
      }
    }
    if (!progressed) break;
    round++;
  }

  return [...bySim, ...diverse];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const LEXICAL_STOP = new Set([
  "that",
  "this",
  "with",
  "from",
  "your",
  "have",
  "what",
  "when",
  "they",
  "them",
  "into",
  "about",
  "think",
  "through",
  "only",
  "will",
  "than",
  "then",
  "some",
  "just",
  "like",
  "been",
  "were",
  "after",
  "also",
  "back",
  "even",
  "such",
  "much",
  "more",
  "most",
  "other",
  "many",
  "very",
  "each",
  "same",
  "both",
  "must",
  "does",
  "post",
  "essay",
  "book",
  "novel",
  "story",
]);

/** Tokens (4+ letters) from the topic brief for lexical chunk matching — helps named characters/places. */
export function significantTermsFromBrief(text: string): string[] {
  const words = text.toLowerCase().match(/[a-zа-яё]{4,}/gi) ?? [];
  return [...new Set(words)].filter((w) => !LEXICAL_STOP.has(w));
}

/** Chunks whose text contains brief terms (boosts retrieval when embeddings miss rare names). */
export function retrieveByLexicalBriefOverlap(
  briefText: string,
  corpus: EmbeddedChunk[],
  topN: number,
  filters: RetrieveFilters = {},
  excludeIds: Set<string> = new Set(),
): EmbeddedChunk[] {
  const terms = significantTermsFromBrief(briefText);
  if (terms.length === 0 || topN <= 0) return [];

  const ranked = corpus
    .filter((c) => {
      if (excludeIds.has(c.id)) return false;
      if (filters.source_type && c.metadata.source_type !== filters.source_type)
        return false;
      if (filters.spoiler_level_max !== undefined) {
        if (
          spoilerRank(c.metadata.spoiler_level) >
          spoilerRank(filters.spoiler_level_max)
        ) {
          return false;
        }
      }
      return true;
    })
    .map((c) => {
      const t = c.text.toLowerCase();
      let hits = 0;
      for (const term of terms) {
        if (t.includes(term)) hits++;
      }
      return { chunk: c, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const out: EmbeddedChunk[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    if (seen.has(row.chunk.id)) continue;
    seen.add(row.chunk.id);
    out.push(row.chunk);
    if (out.length >= topN) break;
  }
  return out;
}

export function mergeChunksWithEmbeddings(
  chunks: import("./schema.js").TextChunk[],
  vectors: Record<string, number[]>,
): EmbeddedChunk[] {
  const out: EmbeddedChunk[] = [];
  for (const c of chunks) {
    const embedding = vectors[c.id];
    if (!embedding) continue;
    out.push({ ...c, embedding });
  }
  return out;
}
