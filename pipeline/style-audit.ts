import type OpenAI from "openai";
import type { ChatCompletionReasoningEffort } from "openai/resources/chat/completions";
import { completionText } from "./openai-chat.js";
import {
  STYLE_AUDIT_APPLY_SYSTEM,
  STYLE_AUDIT_APPLY_VOICE_ADDENDUM,
  STYLE_AUDIT_SYSTEM,
  STYLE_AUDIT_SYSTEM_VOICE_ANCHORED,
} from "./prompts.js";
import { logPipeline } from "./progress-log.js";

export type AuditReplacement = {
  oldText: string;
  newText: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove leaked LLM / track-changes tokens from plain text (e.g. "[delete] a little pleased…").
 */
export function stripBracketEditorArtifacts(text: string): string {
  let t = text;
  t = t.replace(/\s*\[(?:delete|remove|cut|del)\]\s*[^\n]*/gi, "");
  t = t.replace(/\s*\{(?:delete|remove|cut)\}\s*[^\n]*/gi, "");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/ {2,}/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t;
}

/**
 * Locate old snippet in post: exact match, then trim, then whitespace-flexible (audit line breaks vs paragraph).
 */
export function findReplacementSpan(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  const n = needle;
  if (!n) return null;

  let idx = haystack.indexOf(n);
  if (idx !== -1) return { start: idx, end: idx + n.length };

  const trimmed = n.trim();
  if (trimmed && trimmed !== n) {
    idx = haystack.indexOf(trimmed);
    if (idx !== -1) return { start: idx, end: idx + trimmed.length };
  }

  const normNeedle = trimmed.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (normNeedle !== trimmed) {
    idx = haystack.indexOf(normNeedle);
    if (idx !== -1) return { start: idx, end: idx + normNeedle.length };
  }

  const normHay = haystack.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (normHay !== haystack) {
    idx = normHay.indexOf(normNeedle || trimmed);
    if (idx !== -1) return { start: idx, end: idx + (normNeedle || trimmed).length };
  }

  const segs = trimmed.split(/\s+/).filter(Boolean);
  if (segs.length < 2) return null;
  try {
    const re = new RegExp(segs.map(escapeRegExp).join("\\s+"), "s");
    const m = re.exec(haystack);
    if (m) return { start: m.index, end: m.index + m[0].length };
    const m2 = re.exec(normHay);
    if (m2) return { start: m2.index, end: m2.index + m2[0].length };
  } catch {
    return null;
  }
  return null;
}

/** First pass only: freeform audit report (exact STYLE_AUDIT_SYSTEM). */
export async function runAuditReportOnly(
  client: OpenAI,
  model: string,
  markdown: string,
  maxCompletionTokens: number,
  reasoningEffort?: ChatCompletionReasoningEffort | null,
  systemPrompt: string = STYLE_AUDIT_SYSTEM,
): Promise<string> {
  return completionText(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: markdown },
    ],
    maxCompletionTokens,
    reasoningEffort != null ? { reasoning_effort: reasoningEffort } : {},
  );
}

/** Second pass: merge audit into body via JSON (tooling prompt). */
export async function runApplyModelPass(
  client: OpenAI,
  model: string,
  markdown: string,
  auditReport: string,
  maxCompletionTokens: number,
  reasoningEffort?: ChatCompletionReasoningEffort | null,
  applySystem: string = STYLE_AUDIT_APPLY_SYSTEM,
): Promise<string> {
  const raw = await completionText(
    client,
    model,
    [
      { role: "system", content: applySystem },
      {
        role: "user",
        content: JSON.stringify({
          audit_report: auditReport,
          original_plain_text: markdown,
        }),
      },
    ],
    maxCompletionTokens,
    {
      response_format: { type: "json_object" },
      ...(reasoningEffort != null ? { reasoning_effort: reasoningEffort } : {}),
    },
  );
  if (!raw) return markdown;
  try {
    const parsed = JSON.parse(raw) as { revised_markdown?: string };
    if (typeof parsed.revised_markdown === "string" && parsed.revised_markdown.trim()) {
      return stripBracketEditorArtifacts(parsed.revised_markdown);
    }
  } catch {
    return markdown;
  }
  return markdown;
}

/** Audit + model apply (pipeline default for `npm run draft`). */
export async function runFullStyleAudit(
  client: OpenAI,
  model: string,
  markdown: string,
  maxCompletionTokens: number,
  reasoningEffort?: ChatCompletionReasoningEffort | null,
  opts?: { voiceAnchored?: boolean },
): Promise<string> {
  const voiceAnchored = opts?.voiceAnchored === true;
  const auditSystem = voiceAnchored ? STYLE_AUDIT_SYSTEM_VOICE_ANCHORED : STYLE_AUDIT_SYSTEM;
  const applySystem = voiceAnchored
    ? `${STYLE_AUDIT_APPLY_SYSTEM}\n\n${STYLE_AUDIT_APPLY_VOICE_ADDENDUM}`
    : STYLE_AUDIT_APPLY_SYSTEM;
  logPipeline(
    `Style audit: pass 1/2 — full prose audit (${(markdown.length / 1000).toFixed(1)}k chars in)…`,
  );
  const auditReport = await runAuditReportOnly(
    client,
    model,
    markdown,
    maxCompletionTokens,
    reasoningEffort,
    auditSystem,
  );
  logPipeline(`Style audit: pass 2/2 — merge audit into text (JSON response)…`);
  const revised = await runApplyModelPass(
    client,
    model,
    markdown,
    auditReport,
    maxCompletionTokens,
    reasoningEffort,
    applySystem,
  );
  logPipeline(`Style audit: both passes finished.`);
  return revised;
}

/**
 * Parse old sentence / new sentence pairs from an audit report.
 * Skips issues with no new sentence block or placeholder old text.
 */
export function parseAuditReplacements(auditReport: string): AuditReplacement[] {
  const lines = auditReport.replace(/\r\n/g, "\n").split("\n");
  const out: AuditReplacement[] = [];
  let i = 0;

  const trimPara = (parts: string[]) => parts.join("\n").trim();

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const header = line.match(/^old sentence:\s*(.*)$/i);
    if (!header) {
      i++;
      continue;
    }

    const sameLineRest = (header[1] ?? "").trim();
    i++;
    const oldParts: string[] = [];
    if (sameLineRest) oldParts.push(sameLineRest);

    while (i < lines.length) {
      const t = (lines[i] ?? "").trim();
      if (/^why it violates the rules:\s*/i.test(t)) break;
      if (/^old sentence:\s*/i.test(t)) break;
      oldParts.push(lines[i]!);
      i++;
    }

    if (i < lines.length && /^why it violates the rules:\s*/i.test((lines[i] ?? "").trim())) {
      i++;
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        if (/^new sentence:\s*/i.test(t)) break;
        if (/^old sentence:\s*/i.test(t)) break;
        i++;
      }
    }

    const newLineMatch =
      i < lines.length ? (lines[i] ?? "").match(/^new sentence:\s*(.*)$/i) : null;
    if (!newLineMatch) continue;

    i++;
    const newParts: string[] = [];
    const newRest = (newLineMatch[1] ?? "").trim();
    if (newRest) newParts.push(newRest);

    while (i < lines.length) {
      const t = (lines[i] ?? "").trim();
      if (/^old sentence:\s*/i.test(t)) break;
      if (/^new sentence:\s*/i.test(t)) break;
      if (/^why it violates the rules:\s*/i.test(t)) break;
      newParts.push(lines[i]!);
      i++;
    }

    const oldText = trimPara(oldParts);
    const newText = trimPara(newParts);
    if (!oldText) continue;
    if (/^\[full sentence\]$/i.test(oldText)) continue;
    // Empty new sentence = pure deletion of old sentence (supported by applyParsedReplacements).
    out.push({ oldText, newText });
  }

  return out;
}

export type ApplyParsedResult = {
  text: string;
  applied: number;
  skippedOldSnippets: string[];
};

/** Replace each old snippet with new (first occurrence each, in order). */
export function applyParsedReplacements(
  postText: string,
  pairs: AuditReplacement[],
): ApplyParsedResult {
  let result = postText;
  let applied = 0;
  const skippedOldSnippets: string[] = [];

  for (const { oldText, newText } of pairs) {
    const span = findReplacementSpan(result, oldText);
    if (!span) {
      skippedOldSnippets.push(oldText.length > 120 ? `${oldText.slice(0, 117)}...` : oldText);
      continue;
    }
    result =
      result.slice(0, span.start) + newText + result.slice(span.end);
    applied++;
  }

  return {
    text: stripBracketEditorArtifacts(result),
    applied,
    skippedOldSnippets,
  };
}
