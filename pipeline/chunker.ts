import { createHash } from "node:crypto";
import type { ChunkMetadata, TextChunk } from "./schema.js";

export type ChunkerOptions = {
  targetChars: number;
  overlapChars: number;
  minChars: number;
};

const CHAPTER_LINE = /^\s*(chapter|book|part)\s+[\dIVXLC]+/i;

export function chunkPlainText(
  fullText: string,
  baseMeta: Omit<ChunkMetadata, "chunk_index">,
  options: ChunkerOptions,
): TextChunk[] {
  const paragraphs = fullText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= options.targetChars) {
      pieces.push(para);
    } else {
      pieces.push(...splitLongParagraph(para, options.targetChars));
    }
  }

  const segments: { text: string; chapter: string | null }[] = [];
  let buffer = "";
  let activeChapter: string | null = baseMeta.chapter;

  for (const piece of pieces) {
    const headingChapter = detectChapterHeading(piece);
    if (headingChapter) activeChapter = headingChapter;

    const candidate = buffer ? `${buffer}\n\n${piece}` : piece;
    if (
      candidate.length >= options.targetChars &&
      buffer.length >= options.minChars
    ) {
      segments.push({ text: buffer, chapter: activeChapter });
      buffer = applyOverlap(buffer, piece, options.overlapChars);
    } else {
      buffer = candidate;
    }
  }
  if (buffer.trim()) {
    segments.push({ text: buffer, chapter: activeChapter });
  }

  return segments.map((seg, chunkIndex) =>
    makeChunk(seg.text, baseMeta, chunkIndex, seg.chapter),
  );
}

function splitLongParagraph(para: string, maxChars: number): string[] {
  const sentences = para.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const next = buf ? `${buf} ${s}` : s;
    if (next.length > maxChars && buf.length > 0) {
      out.push(buf.trim());
      buf = s;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  if (out.length === 0) return [para];
  return out;
}

function detectChapterHeading(block: string): string | null {
  const first = block.split("\n")[0]?.trim() ?? "";
  if (CHAPTER_LINE.test(first)) return first;
  return null;
}

function applyOverlap(prev: string, nextPara: string, overlapChars: number): string {
  if (overlapChars <= 0) return nextPara;
  const tail = prev.slice(-overlapChars).trim();
  if (!tail) return nextPara;
  return `${tail}\n\n${nextPara}`;
}

function makeChunk(
  text: string,
  baseMeta: Omit<ChunkMetadata, "chunk_index">,
  chunkIndex: number,
  chapter: string | null,
): TextChunk {
  const id = stableChunkId(baseMeta.source_path, chunkIndex, text);
  return {
    id,
    text: text.trim(),
    metadata: {
      ...baseMeta,
      chunk_index: chunkIndex,
      chapter,
    },
  };
}

export function stableChunkId(sourcePath: string, chunkIndex: number, text: string): string {
  const h = createHash("sha256");
  h.update(sourcePath);
  h.update("\n");
  h.update(String(chunkIndex));
  h.update("\n");
  h.update(text.slice(0, 128));
  return h.digest("hex").slice(0, 24);
}
