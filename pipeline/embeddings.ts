import type OpenAI from "openai";
import { logPipeline } from "./progress-log.js";
import type { PipelineConfig } from "./schema.js";
import type { TextChunk } from "./schema.js";

const BATCH = 64;

export async function embedChunks(
  client: OpenAI,
  cfg: PipelineConfig,
  chunks: TextChunk[],
  existing: Record<string, number[]>,
): Promise<Record<string, number[]>> {
  const out = { ...existing };
  const pending = chunks.filter((c) => !out[c.id]);
  const batches = Math.ceil(pending.length / BATCH) || 0;
  if (pending.length === 0) {
    logPipeline(`Embed API: nothing to embed (all chunk IDs already have vectors).`);
    return out;
  }
  logPipeline(
    `Embed API: ${pending.length} chunk(s) in ${batches} batch(es) of up to ${BATCH} (network-bound)…`,
  );
  for (let i = 0; i < pending.length; i += BATCH) {
    const batchNum = Math.floor(i / BATCH) + 1;
    const slice = pending.slice(i, i + BATCH);
    logPipeline(
      `Embed API: batch ${batchNum}/${batches} (${slice.length} texts) → OpenAI…`,
    );
    const input = slice.map((c) => c.text.slice(0, 8000));
    const res = await client.embeddings.create({
      model: cfg.models.embedding,
      input,
    });
    for (const item of res.data) {
      const chunk = slice[item.index];
      if (!chunk) {
        throw new Error("Embedding index mismatch from OpenAI response.");
      }
      out[chunk.id] = item.embedding;
    }
    logPipeline(`Embed API: batch ${batchNum}/${batches} returned OK.`);
  }
  return out;
}
