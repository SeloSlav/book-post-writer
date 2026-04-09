import { z } from "zod";

export const SpoilerLevelSchema = z.enum(["none", "low", "medium", "high"]);
export type SpoilerLevel = z.infer<typeof SpoilerLevelSchema>;

export const SourceTypeSchema = z.enum(["book", "voice"]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const ChunkMetadataSchema = z.object({
  source_type: SourceTypeSchema,
  source_path: z.string(),
  book_name: z.string(),
  chapter: z.string().nullable(),
  spoiler_level: SpoilerLevelSchema,
  characters: z.array(z.string()),
  themes: z.array(z.string()),
  chunk_index: z.number().int().nonnegative(),
});
export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;

export const TextChunkSchema = z.object({
  id: z.string(),
  text: z.string(),
  metadata: ChunkMetadataSchema,
});
export type TextChunk = z.infer<typeof TextChunkSchema>;

export const EmbeddedChunkSchema = TextChunkSchema.extend({
  embedding: z.array(z.number()),
});
export type EmbeddedChunk = z.infer<typeof EmbeddedChunkSchema>;

export const IndexFileSchema = z.object({
  version: z.literal(1),
  created_at: z.string(),
  chunks: z.array(TextChunkSchema),
});
export type IndexFile = z.infer<typeof IndexFileSchema>;

export const EmbeddingsFileSchema = z.object({
  version: z.literal(1),
  model: z.string(),
  vectors: z.record(z.string(), z.array(z.number())),
});
export type EmbeddingsFile = z.infer<typeof EmbeddingsFileSchema>;

export const TopicCandidateSchema = z.object({
  title: z.string(),
  thesis: z.string(),
  angle: z.string(),
  primary_books: z.array(z.string()),
  spoiler_risk: SpoilerLevelSchema,
});
export type TopicCandidate = z.infer<typeof TopicCandidateSchema>;

export const ScoredTopicSchema = TopicCandidateSchema.extend({
  scores: z.object({
    evidence: z.number(),
    voice_fit: z.number(),
    spoiler_safety: z.number(),
    novelty: z.number(),
    total: z.number(),
  }),
});
export type ScoredTopic = z.infer<typeof ScoredTopicSchema>;

/** Placeholder `ScoredTopic.title` when the public headline is written in the draft; user ideas live in `thesis`. */
export const EDITOR_SUPPLIED_BRIEF_TOPIC_TITLE = "Editor-supplied brief";

export const TopicHistorySchema = z.object({
  titles: z.array(z.string()),
});
export type TopicHistory = z.infer<typeof TopicHistorySchema>;

const ReasoningEffortSchema = z
  .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
  .optional();

export const PipelineConfigSchema = z.object({
  models: z.object({
    embedding: z.string(),
    chat: z.string(),
    /** For reasoning models (e.g. gpt-5.4); omit for models that ignore this field. */
    reasoningEffort: ReasoningEffortSchema,
  }),
  chunk: z.object({
    targetChars: z.number().positive(),
    overlapChars: z.number().nonnegative(),
    minChars: z.number().positive(),
  }),
  paths: z.object({
    books: z.string(),
    voice: z.string(),
    output: z.string(),
    indexDir: z.string(),
  }),
  spoilerDefaults: z.object({
    book: SpoilerLevelSchema,
    voice: SpoilerLevelSchema,
  }),
  draft: z.object({
    bookEvidenceK: z.number().int().positive(),
    voiceEvidenceK: z.number().int().positive(),
    maxRevisionRounds: z.number().int().nonnegative(),
    minWordCount: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxOutputTokensOutline: z.number().int().positive(),
    maxOutputTokensCompact: z.number().int().positive(),
  }),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
