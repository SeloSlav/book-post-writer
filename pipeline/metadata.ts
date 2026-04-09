import path from "node:path";
import type { ChunkMetadata, SourceType, SpoilerLevel } from "./schema.js";

const KNOWN_CHARACTER_HINTS = [
  "Agatha",
  "Sasha",
  "Savinkov",
  "Babushka",
] as const;

const THEME_KEYWORDS: { theme: string; pattern: RegExp }[] = [
  { theme: "power", pattern: /\b(power|throne|empire|rule|reign)\b/i },
  { theme: "betrayal", pattern: /\b(betray|traitor|lie|deceit)\b/i },
  { theme: "death", pattern: /\b(death|die|kill|murder|corpse)\b/i },
  { theme: "memory", pattern: /\b(memory|remember|forgot|past)\b/i },
  { theme: "identity", pattern: /\b(identity|self|mask|who you are)\b/i },
];

export function bookNameFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  const withoutVersion = base.replace(/-v\d+$/i, "");
  return withoutVersion.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

export function buildBaseMetadata(params: {
  sourcePath: string;
  rootDir: string;
  source_type: SourceType;
  spoilerDefault: SpoilerLevel;
}): Omit<ChunkMetadata, "chunk_index"> {
  const rel = path.relative(params.rootDir, params.sourcePath);
  const book_name =
    params.source_type === "book"
      ? bookNameFromFilename(params.sourcePath)
      : `voice:${bookNameFromFilename(params.sourcePath)}`;

  return {
    source_type: params.source_type,
    source_path: rel.split(path.sep).join("/"),
    book_name,
    chapter: null,
    spoiler_level: params.spoilerDefault,
    characters: inferCharacters(params.sourcePath),
    themes: [],
  };
}

function inferCharacters(_sourcePath: string): string[] {
  void _sourcePath;
  return [];
}

export function enrichChunkThemes(text: string, existing: string[]): string[] {
  const set = new Set(existing);
  for (const { theme, pattern } of THEME_KEYWORDS) {
    if (pattern.test(text)) set.add(theme);
  }
  return [...set];
}

export function enrichChunkCharacters(text: string, existing: string[]): string[] {
  const set = new Set(existing);
  for (const name of KNOWN_CHARACTER_HINTS) {
    if (text.includes(name)) set.add(name);
  }
  return [...set];
}

export function bumpSpoilerIfTextSuggests(text: string, current: SpoilerLevel): SpoilerLevel {
  const heavy =
    /\b(killed|dies|death of|reveals? that|plot twist|ending|epilogue)\b/i.test(
      text,
    );
  if (!heavy) return current;
  if (current === "high") return current;
  if (current === "none") return "medium";
  if (current === "low") return "medium";
  return "high";
}
