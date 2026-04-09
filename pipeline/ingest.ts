import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import { chunkPlainText } from "./chunker.js";
import { extractTextFromDocx } from "./docx.js";
import {
  buildBaseMetadata,
  bumpSpoilerIfTextSuggests,
  enrichChunkCharacters,
  enrichChunkThemes,
} from "./metadata.js";
import type { PipelineConfig, TextChunk } from "./schema.js";

function isVoiceNoiseFile(absPath: string): boolean {
  const base = path.basename(absPath);
  if (base.startsWith("~$")) return true;
  return /^readme\.txt$/i.test(base);
}

export async function collectDocxFiles(rootDir: string): Promise<string[]> {
  const files = await fg("**/*.docx", {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
  });
  return files.filter((f) => !isVoiceNoiseFile(f));
}

/** Voice folder: samples of your writing as .docx and/or verbatim .txt (UTF-8). Skips README.txt. Uses cwd glob for reliable Windows paths. */
export async function collectVoiceFolderFiles(rootDir: string): Promise<string[]> {
  const docx = await fg("**/*.docx", {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
  });
  const txt = await fg("**/*.txt", {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
  });
  const merged = [...docx, ...txt].filter((f) => !isVoiceNoiseFile(f));
  merged.sort((a, b) => a.localeCompare(b, "en"));
  return merged;
}

export async function ingestSourceFolder(params: {
  rootDir: string;
  source_type: "book" | "voice";
  spoilerDefault: import("./schema.js").SpoilerLevel;
  chunk: PipelineConfig["chunk"];
  allowEmpty?: boolean;
}): Promise<TextChunk[]> {
  const exists = await fs
    .access(params.rootDir)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    if (params.allowEmpty) return [];
    throw new Error(
      `Source folder does not exist: ${params.rootDir}\nCreate it or fix paths in pipeline.config.json.`,
    );
  }

  const files =
    params.source_type === "voice"
      ? await collectVoiceFolderFiles(params.rootDir)
      : await collectDocxFiles(params.rootDir);
  if (files.length === 0) {
    if (params.allowEmpty) return [];
    const hint =
      params.source_type === "voice"
        ? "Add .docx or .txt files (e.g. exported posts or pasted drafts)."
        : "Add .docx files here, or set paths.books in pipeline.config.json (or PIPELINE_BOOKS in .env) to your manuscript folder.";
    throw new Error(`No source files found under ${params.rootDir}.\n${hint}`);
  }

  const all: TextChunk[] = [];
  for (const file of files) {
    let text: string;
    if (file.toLowerCase().endsWith(".txt")) {
      text = await fs.readFile(file, "utf8");
    } else {
      const extracted = await extractTextFromDocx(file);
      if (extracted.messages.length) {
        console.warn(`mammoth messages for ${file}:`, extracted.messages.join("; "));
      }
      text = extracted.text;
    }
    if (!text.trim()) {
      console.warn(`Skipping empty extract: ${file}`);
      continue;
    }
    const baseMeta = buildBaseMetadata({
      sourcePath: file,
      rootDir: params.rootDir,
      source_type: params.source_type,
      spoilerDefault: params.spoilerDefault,
    });
    const parts = chunkPlainText(text, baseMeta, params.chunk);
    for (const ch of parts) {
      const themes = enrichChunkThemes(ch.text, ch.metadata.themes);
      const characters = enrichChunkCharacters(ch.text, ch.metadata.characters);
      const spoiler_level = bumpSpoilerIfTextSuggests(
        ch.text,
        ch.metadata.spoiler_level,
      );
      all.push({
        ...ch,
        metadata: { ...ch.metadata, themes, characters, spoiler_level },
      });
    }
  }
  return all;
}
