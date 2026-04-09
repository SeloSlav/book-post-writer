import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PipelineConfig } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const CONFIG_FILENAME = "pipeline.config.json";

const defaultConfig: PipelineConfig = {
  models: {
    embedding: "text-embedding-3-small",
    chat: "gpt-5.4",
  },
  chunk: {
    targetChars: 1200,
    overlapChars: 200,
    minChars: 400,
  },
  paths: {
    books: "data/books",
    voice: "data/voice",
    output: "data/output",
    indexDir: "data/index",
  },
  spoilerDefaults: {
    book: "medium",
    voice: "low",
  },
  draft: {
    bookEvidenceK: 28,
    voiceEvidenceK: 16,
    maxRevisionRounds: 2,
    minWordCount: 1100,
    maxOutputTokens: 12_000,
    maxOutputTokensOutline: 3200,
    maxOutputTokensCompact: 900,
  },
};

function resolvePaths(cfg: PipelineConfig): PipelineConfig {
  const resolve = (p: string) =>
    path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
  return {
    ...cfg,
    paths: {
      books: resolve(cfg.paths.books),
      voice: resolve(cfg.paths.voice),
      output: resolve(cfg.paths.output),
      indexDir: resolve(cfg.paths.indexDir),
    },
  };
}

export function loadConfig(): PipelineConfig {
  const configPath = path.join(REPO_ROOT, CONFIG_FILENAME);
  let merged: PipelineConfig = { ...defaultConfig };
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<PipelineConfig>;
    merged = {
      ...defaultConfig,
      ...raw,
      models: { ...defaultConfig.models, ...raw.models },
      chunk: { ...defaultConfig.chunk, ...raw.chunk },
      paths: { ...defaultConfig.paths, ...raw.paths },
      spoilerDefaults: { ...defaultConfig.spoilerDefaults, ...raw.spoilerDefaults },
      draft: { ...defaultConfig.draft, ...raw.draft },
    };
  }
  const envBooks = process.env.PIPELINE_BOOKS?.trim();
  if (envBooks) {
    merged = {
      ...merged,
      paths: { ...merged.paths, books: envBooks },
    };
  }
  return resolvePaths(merged);
}

export function repoRoot(): string {
  return REPO_ROOT;
}
