import type OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { embedChunks } from "./embeddings.js";
import { completionText } from "./openai-chat.js";
import {
  CTA_GENERATION_RULES,
  PLAIN_POST_RULES,
  VOICE_RULES,
  VOICE_SAMPLE_MIRROR_RULES,
} from "./prompts.js";
import { logPipeline } from "./progress-log.js";
import { runFullStyleAudit } from "./style-audit.js";
import {
  mergeChunksWithEmbeddings,
  retrieveByLexicalBriefOverlap,
  retrieveBySimilarity,
  retrieveVoiceChunksForDraft,
} from "./retrieve.js";
import {
  EDITOR_SUPPLIED_BRIEF_TOPIC_TITLE,
  type PipelineConfig,
  type ScoredTopic,
} from "./schema.js";
import type { EmbeddedChunk, TextChunk } from "./schema.js";

export type DraftResult = {
  topic: ScoredTopic;
  outline: string;
  draft_markdown: string;
  revised_markdown: string;
  audited_markdown: string;
  cta: string;
};

const BRIEF_BINDING_RULES = `
The editorial brief in the user message is the contract for this piece. Follow it over any generic reading of the books. If the outline or earlier draft drifts away from the brief (different characters, theme, or thesis), realign to the brief.
Prioritize book evidence that mentions people, relationships, or motifs named in the editorial brief when those names or clear variants appear in the excerpts.
`.trim();

const BOOK_GROUNDING_RULES = `
Book grounding (required):
- Do not invent plot, characters, settings, or causal chains that are not supported by the evidence blocks. If the excerpts are insufficient for a claim, say that plainly and stay with what the text shows.
`.trim();

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Body only: text after the first blank-line-separated block (public title / optional subtitle).
 * If there is no second block, counts the whole post (legacy shape).
 */
function countBodyWords(fullPost: string): number {
  const t = fullPost.trim();
  if (!t) return 0;
  const blocks = t.split(/\n\s*\n/);
  if (blocks.length <= 1) return countWords(t);
  return countWords(blocks.slice(1).join("\n\n"));
}

function chatExtra(
  cfg: PipelineConfig,
  more?: Partial<ChatCompletionCreateParamsNonStreaming>,
): Partial<ChatCompletionCreateParamsNonStreaming> {
  const effort = cfg.models.reasoningEffort;
  return {
    ...(effort !== undefined && effort !== null ? { reasoning_effort: effort } : {}),
    ...more,
  };
}

/** User-facing copy for outline + draft: ideas only; headline is written in the essay. */
function topicBriefForPrompt(topic: ScoredTopic): string {
  const lines: string[] = [
    "Editorial brief — what to cover and argue (this is not the public headline; you will write title and optional subtitle in the finished post):",
  ];
  if (topic.title !== EDITOR_SUPPLIED_BRIEF_TOPIC_TITLE) {
    lines.push(`Topic label: ${topic.title}`, "");
  }
  lines.push(topic.thesis, "", "Further direction:", topic.angle);
  if (topic.primary_books.length > 0) {
    lines.push("", `Named books: ${topic.primary_books.join(", ")}`);
  }
  return lines.join("\n");
}

export async function generatePost(params: {
  client: OpenAI;
  cfg: PipelineConfig;
  topic: ScoredTopic;
  bookChunks: TextChunk[];
  voiceChunks: TextChunk[];
  vectors: Record<string, number[]>;
}): Promise<DraftResult> {
  const bookCorpus = mergeChunksWithEmbeddings(params.bookChunks, params.vectors);
  const voiceCorpus = mergeChunksWithEmbeddings(params.voiceChunks, params.vectors);

  const editorialBrief = topicBriefForPrompt(params.topic);

  const topicChunk: TextChunk = {
    id: "query-topic",
    text: `${params.topic.thesis}\n${params.topic.thesis}\n${params.topic.angle}`,
    metadata: {
      source_type: "book",
      source_path: "synthetic/query",
      book_name: "synthetic",
      chapter: null,
      spoiler_level: "low",
      characters: [],
      themes: [],
      chunk_index: 0,
    },
  };

  logPipeline(`Draft LLM: embedding topic query for retrieval…`);
  const qv = await embedChunks(params.client, params.cfg, [topicChunk], {});
  const query = qv["query-topic"];
  if (!query) throw new Error("Failed to embed query topic.");

  const spoilerCap = params.topic.spoiler_risk;

  logPipeline(
    `Draft LLM: chat model ${params.cfg.models.chat}` +
      (params.cfg.models.reasoningEffort
        ? `, reasoning_effort=${params.cfg.models.reasoningEffort}`
        : ""),
  );
  logPipeline(
    `Draft LLM: retrieved ${params.cfg.draft.bookEvidenceK} book + ${params.cfg.draft.voiceEvidenceK} voice snippet(s); generating outline…`,
  );
  const simK = Math.max(8, params.cfg.draft.bookEvidenceK - 8);
  const similarityHits = retrieveBySimilarity(query, bookCorpus, simK, {
    source_type: "book",
    spoiler_level_max: spoilerCap,
  });
  const seenSim = new Set(similarityHits.map((c) => c.id));
  const lexicalExtra = Math.max(0, params.cfg.draft.bookEvidenceK - similarityHits.length);
  const lexicalHits = retrieveByLexicalBriefOverlap(
    params.topic.thesis,
    bookCorpus,
    lexicalExtra,
    {
      source_type: "book",
      spoiler_level_max: spoilerCap,
    },
    seenSim,
  );
  const bookEvidence: EmbeddedChunk[] = [...similarityHits];
  for (const c of lexicalHits) {
    if (bookEvidence.length >= params.cfg.draft.bookEvidenceK) break;
    bookEvidence.push(c);
  }
  logPipeline(
    `Draft LLM: book evidence = ${similarityHits.length} similarity + ${lexicalHits.length} lexical name/brief overlap → ${bookEvidence.length} snippet(s).`,
  );
  const voiceEvidence = retrieveVoiceChunksForDraft(
    query,
    voiceCorpus,
    params.cfg.draft.voiceEvidenceK,
  );
  const hasVoiceSamples = voiceEvidence.length > 0;
  /** Ingested excerpts override generic VOICE_RULES so the model does not blend two competing voices. */
  const voiceStyleRules = hasVoiceSamples ? VOICE_SAMPLE_MIRROR_RULES : VOICE_RULES;

  const bookBlock = formatBookEvidence(bookEvidence);
  const voiceBlock = formatVoiceEvidence(voiceEvidence);
  if (hasVoiceSamples) {
    logPipeline(
      `Draft LLM: voice excerpts = ${voiceEvidence.length} (topic-similar + spread across files for cadence).`,
    );
  }

  const outline = await completionText(
    params.client,
    params.cfg.models.chat,
    [
      {
        role: "system",
        content: [
          hasVoiceSamples
            ? "You outline notes for a long-form piece. Section shape, pacing, and attitude must imitate the author in \"Your past posts\" — applied to the editorial brief and book evidence, not a generic essay skeleton."
            : "You outline a long-form literary analysis essay as plain-text notes.",
          BRIEF_BINDING_RULES,
          "Use the evidence as grounding; do not invent plot facts beyond it.",
          "You may use a provisional working headline in the outline for your own structure; the final public title and optional subtitle will be written only in the full essay.",
          PLAIN_POST_RULES,
          voiceStyleRules,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          editorialBrief,
          "",
          "Book evidence excerpts:",
          bookBlock,
          "",
          "Your past posts (match how you write — rhythm, attitude, openings; ignore their old topics):",
          voiceBlock ||
            "(none ingested — follow the general voice guidance in the system message.)",
          "",
          "Write a tight outline as plain text: opening hook, then 5 to 8 sections for a full long-form essay (name each section on its own line), under each section use lines starting with hyphen and space for bullets. Each section should support a distinct claim or scene cluster from the evidence. This outline is notes only, not the final post.",
          "Every section must serve the editorial brief above (characters, relationships, or angles it names). Do not substitute a different thesis because the snippets mention other themes.",
        ].join("\n"),
      },
    ],
    params.cfg.draft.maxOutputTokensOutline,
    chatExtra(params.cfg),
  );

  logPipeline(`Draft LLM: outline done; writing first full draft (long completion)…`);
  let firstDraft = await completionText(
    params.client,
    params.cfg.models.chat,
    [
      {
        role: "system",
        content: [
          hasVoiceSamples
            ? "You write the full post as plain text (paragraphs separated by a blank line). Sound indistinguishable from the author in \"Your past posts\" while arguing about the editorial brief using only book evidence."
            : "You write the full post as plain text (paragraphs separated by a blank line), suitable for email or web publishing.",
          BRIEF_BINDING_RULES,
          BOOK_GROUNDING_RULES,
          "Ground every interpretive claim in the book evidence; prefer quoting or echoing snippet wording.",
          PLAIN_POST_RULES,
          voiceStyleRules,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          editorialBrief,
          "",
          `Target length: at least ${params.cfg.draft.minWordCount} words in the body only (title + optional subtitle do not count). When the brief supports it, aim closer to 1000–1250 words before you stop — do not stop at the bare minimum. Develop multiple scenes, quotes, and through-lines; this should read like a full essay, not a recap.`,
          "",
          "Outline (subordinate to the editorial brief — if it conflicts with the brief, follow the brief):",
          outline,
          "",
          "Book evidence:",
          bookBlock,
          "",
          "Your past posts (you must sound like this author; book facts only from book evidence above):",
          voiceBlock ||
            "(none — avoid bland critic register; write like a real person with a point of view.)",
          "",
          "Write the full essay about what the editorial brief asks for. Line 1: the public post title you invent from the brief and evidence. Line 2: optional subtitle, or leave blank and go straight to a blank line before the body. No fake quotes: only use quoted words that appear in the book evidence above. Use many paragraphs; do not end until the body is substantively developed.",
        ].join("\n"),
      },
    ],
    params.cfg.draft.maxOutputTokens,
    chatExtra(params.cfg),
  );

  if (countBodyWords(firstDraft) < params.cfg.draft.minWordCount) {
    logPipeline(
      `Draft LLM: first draft body ~${countBodyWords(firstDraft)} words — expanding toward ${params.cfg.draft.minWordCount} with same evidence…`,
    );
    firstDraft = await completionText(
      params.client,
      params.cfg.models.chat,
      [
        {
          role: "system",
          content: [
            "You expand a short draft into a full long-form essay using ONLY the book evidence provided.",
            BRIEF_BINDING_RULES,
            BOOK_GROUNDING_RULES,
            PLAIN_POST_RULES,
            voiceStyleRules,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            editorialBrief,
            "",
            `The body (below the title block) is under ${params.cfg.draft.minWordCount} words. Rewrite and expand so the body alone is at least ${params.cfg.draft.minWordCount} words.`,
            "Add more book-close reading, quoted or echoed phrases from the evidence, and developed argument; do not pad with generic filler. Keep the same thesis; adjust the title or subtitle only if they no longer fit.",
            "",
            "Book evidence:",
            bookBlock,
            ...(hasVoiceSamples
              ? [
                  "",
                  "Your past posts (keep this voice while expanding):",
                  voiceBlock,
                ]
              : []),
            "",
            "Current draft:",
            firstDraft,
          ].join("\n"),
        },
      ],
      params.cfg.draft.maxOutputTokens,
      chatExtra(params.cfg),
    );
  }

  let working = firstDraft;
  for (let r = 0; r < params.cfg.draft.maxRevisionRounds; r++) {
    logPipeline(`Draft LLM: voice revision round ${r + 1}/${params.cfg.draft.maxRevisionRounds}…`);
    working = await completionText(
      params.client,
      params.cfg.models.chat,
      [
        {
          role: "system",
          content: [
            hasVoiceSamples
              ? "You revise prose to match the excerpts in \"Your past posts\" exactly — not a cleaner or more generic voice."
              : "You revise prose to match the author's real voice from the excerpts — not a polished generic newsletter voice.",
            BRIEF_BINDING_RULES,
            "Do not remove book titles, quotes from the manuscripts, or evidence-based claims. Do not shorten the body below the minimum word target.",
            `The body (after title block) must stay at least ${params.cfg.draft.minWordCount} words. If revision would go under, add grounded paragraphs from the evidence instead of cutting.`,
            voiceStyleRules,
            PLAIN_POST_RULES,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            editorialBrief,
            "",
            "Book evidence (preserve grounding):",
            bookBlock,
            "",
            ...(hasVoiceSamples
              ? ["Your past posts (primary style target):", voiceBlock, ""]
              : []),
            "Draft to revise:",
            working,
          ].join("\n"),
        },
      ],
      params.cfg.draft.maxOutputTokens,
      chatExtra(params.cfg),
    );
  }

  if (countBodyWords(working) < params.cfg.draft.minWordCount) {
    logPipeline(
      `Draft LLM: after revision body ~${countBodyWords(working)} words — one expansion pass…`,
    );
    working = await completionText(
      params.client,
      params.cfg.models.chat,
      [
        {
          role: "system",
          content: [
            "You expand plain-text prose to meet a minimum length using only the book evidence.",
            BRIEF_BINDING_RULES,
            BOOK_GROUNDING_RULES,
            PLAIN_POST_RULES,
            voiceStyleRules,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            editorialBrief,
            "",
            `Expand the body (after the title block) to at least ${params.cfg.draft.minWordCount} words. Add grounded close reading and evidence-tied paragraphs, not filler.`,
            "",
            "Book evidence:",
            bookBlock,
            ...(hasVoiceSamples
              ? ["", "Your past posts (voice must stay yours):", voiceBlock]
              : []),
            "",
            "Draft:",
            working,
          ].join("\n"),
        },
      ],
      params.cfg.draft.maxOutputTokens,
      chatExtra(params.cfg),
    );
  }

  let audited = await runFullStyleAudit(
    params.client,
    params.cfg.models.chat,
    working,
    params.cfg.draft.maxOutputTokens,
    params.cfg.models.reasoningEffort,
    { voiceAnchored: hasVoiceSamples },
  );

  let bodyW = countBodyWords(audited);
  logPipeline(
    `Draft LLM: after style audit, body ~${bodyW} words (min ${params.cfg.draft.minWordCount}).`,
  );
  if (bodyW < params.cfg.draft.minWordCount) {
    logPipeline(
      `Draft LLM: audit shortened the body — expanding back to at least ${params.cfg.draft.minWordCount} words without undoing audit fixes…`,
    );
    audited = await completionText(
      params.client,
      params.cfg.models.chat,
      [
        {
          role: "system",
          content: [
            "The draft below already passed an automated style audit. Your job is to LENGTHEN the body only.",
            "Keep the same title block (first paragraph(s) before the first double line break) and the same voice/tightening the audit achieved.",
            "Add new paragraphs drawn from the book evidence — more quotes, paraphrases, and analysis — until the body meets the word minimum.",
            "Do not revert good edits; do not add generic filler; do not use markdown.",
            BRIEF_BINDING_RULES,
            BOOK_GROUNDING_RULES,
            PLAIN_POST_RULES,
            voiceStyleRules,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            editorialBrief,
            "",
            `Body must be at least ${params.cfg.draft.minWordCount} words (count only text after the first blank-line-separated title block).`,
            "",
            "Book evidence:",
            bookBlock,
            ...(hasVoiceSamples
              ? ["", "Your past posts (new paragraphs must still match this voice):", voiceBlock]
              : []),
            "",
            "Current post (preserve structure of title block; expand what follows):",
            audited,
          ].join("\n"),
        },
      ],
      params.cfg.draft.maxOutputTokens,
      chatExtra(params.cfg),
    );
    bodyW = countBodyWords(audited);
    logPipeline(`Draft LLM: post-audit expansion done; body ~${bodyW} words.`);
  }
  logPipeline(`Draft LLM: generating CTA from finished article…`);
  const cta = await generateCtaFromArticle(params.client, params.cfg.models.chat, params.cfg, {
    articlePlain: audited,
    topic: params.topic,
    bookEvidence,
    voiceStyleRules,
  });

  logPipeline(`Draft LLM: all generation steps complete for this topic.`);
  return {
    topic: params.topic,
    outline,
    draft_markdown: firstDraft,
    revised_markdown: working,
    audited_markdown: audited,
    cta,
  };
}

function formatBookEvidence(chunks: import("./schema.js").EmbeddedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[Book snippet ${i + 1} — ${c.metadata.book_name}, spoiler=${c.metadata.spoiler_level}]\n${c.text}`,
    )
    .join("\n\n");
}

function formatVoiceEvidence(chunks: import("./schema.js").EmbeddedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[Your past post ${i + 1} — file: ${c.metadata.source_path}]\n${c.text}`,
    )
    .join("\n\n");
}

async function generateCtaFromArticle(
  client: OpenAI,
  model: string,
  cfg: PipelineConfig,
  params: {
    articlePlain: string;
    topic: ScoredTopic;
    bookEvidence: import("./schema.js").EmbeddedChunk[];
    voiceStyleRules: string;
  },
): Promise<string> {
  const fromEvidence = [
    ...new Set(
      params.bookEvidence.map((c) => c.metadata.book_name).filter(Boolean),
    ),
  ];
  const allowedBooks = [
    ...new Set([...params.topic.primary_books, ...fromEvidence]),
  ];
  const articleForPrompt = clampForPrompt(params.articlePlain, 28_000);

  try {
    const raw = await completionText(
      client,
      model,
      [
        {
          role: "system",
          content: [CTA_GENERATION_RULES, "", params.voiceStyleRules].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            allowed_book_titles: allowedBooks,
            editor_topic_brief: params.topic.thesis.slice(0, 800),
            article_plain_text: articleForPrompt,
          }),
        },
      ],
      cfg.draft.maxOutputTokensCompact,
      chatExtra(cfg, { response_format: { type: "json_object" } }),
    );
    const parsed = JSON.parse(raw) as { cta?: string };
    const line = typeof parsed.cta === "string" ? parsed.cta.trim() : "";
    if (!line) return fallbackCta(params.topic, params.bookEvidence);
    return line;
  } catch {
    return fallbackCta(params.topic, params.bookEvidence);
  }
}

function clampForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.45);
  const tail = maxChars - head - 80;
  return [
    text.slice(0, head),
    "\n\n[... middle of article omitted for length ...]\n\n",
    text.slice(-tail),
  ].join("");
}

function fallbackCta(
  topic: ScoredTopic,
  bookEvidence: import("./schema.js").EmbeddedChunk[],
): string {
  const preferred = topic.primary_books[0];
  const fallback = bookEvidence[0]?.metadata.book_name;
  const book = preferred ?? fallback ?? "the series";
  return `If you want the thing this post is chewing on in full, start with ${book}.`;
}
