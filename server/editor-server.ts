import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "../pipeline/config.js";
import {
  clearPipelineLog,
  logPipeline,
  snapshotPipelineLog,
} from "../pipeline/progress-log.js";
import { getOpenAI } from "../pipeline/openai-client.js";
import type { AuditReplacement } from "../pipeline/style-audit.js";
import {
  getPipelineStatus,
  pipelineDraft,
  pipelineEmbed,
  pipelineFull,
  pipelineIngest,
  pipelineIngestBooksOnly,
  pipelineIngestVoiceOnly,
  readLatestDraft,
  saveEditorDraft,
} from "../pipeline/runner.js";
import {
  applyParsedReplacements,
  parseAuditReplacements,
  runApplyModelPass,
  runAuditReportOnly,
} from "../pipeline/style-audit.js";

const PORT = Number(process.env.EDITOR_API_PORT ?? 8787);

/** Path only: strip query, fragment, trailing slash, and tolerate absolute req.url from some proxies. */
function apiPath(req: IncomingMessage): string {
  let raw = req.url ?? "/";
  if (raw.includes("://")) {
    try {
      const u = new URL(raw);
      raw = u.pathname + (u.search ?? "");
    } catch {
      /* keep raw */
    }
  }
  const hash = raw.indexOf("#");
  if (hash !== -1) raw = raw.slice(0, hash);
  const q = raw.indexOf("?");
  let p = q === -1 ? raw : raw.slice(0, q);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

/** Plain post body from JSON; accepts legacy `markdown` for older clients. */
function postBodyText(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const o = body as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (typeof o.markdown === "string") return o.markdown;
  return undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = apiPath(req);

    if (req.method === "GET" && url === "/api/health") {
      const cfg = loadConfig();
      sendJson(res, 200, { ok: true, chatModel: cfg.models.chat });
      return;
    }

    if (req.method === "GET" && url === "/api/pipeline/status") {
      const status = await getPipelineStatus();
      sendJson(res, 200, status);
      return;
    }

    if (req.method === "GET" && url === "/api/pipeline/latest-draft") {
      const latest = await readLatestDraft();
      if (!latest) {
        sendJson(res, 404, {
          error: "No saved post in the output folder yet. Generate one first.",
        });
        return;
      }
      sendJson(res, 200, latest);
      return;
    }

    if (req.method === "GET" && url === "/api/pipeline/log") {
      sendJson(res, 200, { lines: snapshotPipelineLog() });
      return;
    }

    if (req.method === "POST" && url === "/api/pipeline/save-draft") {
      clearPipelineLog();
      logPipeline(`HTTP POST /api/pipeline/save-draft — write Post pane to output folder`);
      const body = (await readJsonBody(req)) as {
        text?: string;
        strategy?: "prefer-latest" | "always-new";
      };
      const postText = postBodyText(body);
      if (typeof postText !== "string") {
        sendJson(res, 400, { error: "text: string required (plain post body)." });
        return;
      }
      const strategy =
        body.strategy === "always-new" ? "always-new" : "prefer-latest";
      try {
        const r = await saveEditorDraft({ text: postText, strategy });
        logPipeline(`HTTP: save-draft finished (${r.kind}).`);
        sendJson(res, 200, {
          ok: true,
          path: r.path,
          kind: r.kind,
          pipelineLogLines: snapshotPipelineLog(),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 500, { error: msg });
      }
      return;
    }

    if (req.method === "POST" && url === "/api/pipeline/ingest") {
      clearPipelineLog();
      logPipeline(`HTTP POST /api/pipeline/ingest — ingest ALL (books + voice, slow on big corpus)`);
      const r = await pipelineIngest();
      logPipeline(`HTTP: ingest finished OK.`);
      sendJson(res, 200, { ok: true, ingestMode: "all", ...r });
      return;
    }

    if (req.method === "POST" && url === "/api/pipeline/ingest-books") {
      clearPipelineLog();
      logPipeline(`HTTP POST /api/pipeline/ingest-books — manuscripts only, keep voice chunks`);
      const r = await pipelineIngestBooksOnly();
      logPipeline(`HTTP: ingest books finished OK.`);
      sendJson(res, 200, { ok: true, ingestMode: "books", ...r });
      return;
    }

    if (req.method === "POST" && url === "/api/pipeline/ingest-voice") {
      clearPipelineLog();
      logPipeline(`HTTP POST /api/pipeline/ingest-voice — voice samples only, keep book chunks`);
      const r = await pipelineIngestVoiceOnly();
      logPipeline(`HTTP: ingest voice finished OK.`);
      sendJson(res, 200, { ok: true, ingestMode: "voice", ...r });
      return;
    }

    if (req.method === "POST" && url === "/api/pipeline/embed") {
      clearPipelineLog();
      logPipeline(`HTTP POST /api/pipeline/embed — OpenAI embeddings for all chunks needing vectors`);
      const r = await pipelineEmbed();
      logPipeline(`HTTP: embed finished OK.`);
      sendJson(res, 200, { ok: true, ...r });
      return;
    }

    if (req.method === "POST" && url === "/api/pipeline/draft") {
      clearPipelineLog();
      logPipeline(`HTTP POST /api/pipeline/draft — full post generation (many model calls)`);
      const body = (await readJsonBody(req)) as { customTopicPrompt?: string };
      const manual =
        typeof body.customTopicPrompt === "string"
          ? body.customTopicPrompt.trim()
          : "";
      if (manual.length < 12) {
        sendJson(res, 400, {
          error:
            "customTopicPrompt is required: describe what you want the post to cover (at least 12 characters). Title and subtitle are written by the model in the draft.",
        });
        return;
      }
      const r = await pipelineDraft({ customTopicPrompt: manual });
      logPipeline(`HTTP: draft finished OK.`);
      sendJson(res, 200, {
        ok: true,
        ...r,
        draftTopicPreview: manual.slice(0, 400),
        pipelineLogLines: snapshotPipelineLog(),
      });
      return;
    }

    if (req.method === "POST" && url === "/api/pipeline/full") {
      clearPipelineLog();
      logPipeline(`HTTP POST /api/pipeline/full — ingest → embed → draft (your topic ideas)`);
      const body = (await readJsonBody(req)) as { customTopicPrompt?: string };
      const manual =
        typeof body.customTopicPrompt === "string"
          ? body.customTopicPrompt.trim()
          : "";
      if (manual.length < 12) {
        sendJson(res, 400, {
          error:
            "customTopicPrompt is required for the full pipeline (at least 12 characters).",
        });
        return;
      }
      const r = await pipelineFull({ customTopicPrompt: manual });
      logPipeline(`HTTP: full pipeline finished OK.`);
      sendJson(res, 200, {
        ok: true,
        ...r,
        draftTopicPreview: manual.slice(0, 400),
        pipelineLogLines: snapshotPipelineLog(),
      });
      return;
    }

    if (req.method === "POST" && url === "/api/audit") {
      const body = await readJsonBody(req);
      const postText = postBodyText(body);
      if (typeof postText !== "string") {
        sendJson(res, 400, { error: "Body must include text: string (plain post body)." });
        return;
      }
      const cfg = loadConfig();
      const client = getOpenAI();
      const auditReport = await runAuditReportOnly(
        client,
        cfg.models.chat,
        postText,
        cfg.draft.maxOutputTokens,
        cfg.models.reasoningEffort,
      );
      const pairs = parseAuditReplacements(auditReport);
      sendJson(res, 200, { auditReport, pairs });
      return;
    }

    if (req.method === "POST" && url === "/api/parse-pairs") {
      const body = (await readJsonBody(req)) as { auditReport?: string };
      if (typeof body.auditReport !== "string") {
        sendJson(res, 400, { error: "auditReport: string required" });
        return;
      }
      const pairs = parseAuditReplacements(body.auditReport);
      sendJson(res, 200, { pairs });
      return;
    }

    if (req.method === "POST" && url === "/api/apply-parsed") {
      const body = (await readJsonBody(req)) as {
        auditReport?: string;
        enabledFlags?: boolean[];
      };
      const postText = postBodyText(body);
      if (typeof postText !== "string") {
        sendJson(res, 400, { error: "text: string required (plain post body)." });
        return;
      }
      if (typeof body.auditReport !== "string") {
        sendJson(res, 400, { error: "auditReport: string required" });
        return;
      }
      const all = parseAuditReplacements(body.auditReport);
      let pairs: AuditReplacement[];
      let warning: string | undefined;
      if (
        Array.isArray(body.enabledFlags) &&
        body.enabledFlags.length === all.length
      ) {
        pairs = all.filter((_, i) => body.enabledFlags![i]);
      } else {
        pairs = all;
        if (
          Array.isArray(body.enabledFlags) &&
          body.enabledFlags.length !== all.length
        ) {
          warning =
            "enabledFlags length did not match parsed pairs; applied all replacements. Use “Re-parse from report”.";
        }
      }
      const { text, applied, skippedOldSnippets } = applyParsedReplacements(
        postText,
        pairs,
      );
      sendJson(res, 200, {
        text,
        applied,
        skippedOldSnippets,
        pairCount: all.length,
        warning,
      });
      return;
    }

    if (req.method === "POST" && url === "/api/apply-model") {
      const body = await readJsonBody(req);
      const postText = postBodyText(body);
      const auditReport =
        body && typeof body === "object" && typeof (body as { auditReport?: string }).auditReport === "string"
          ? (body as { auditReport: string }).auditReport
          : undefined;
      if (typeof postText !== "string" || typeof auditReport !== "string") {
        sendJson(res, 400, {
          error: "text and auditReport strings required",
        });
        return;
      }
      const cfg = loadConfig();
      const client = getOpenAI();
      const text = await runApplyModelPass(
        client,
        cfg.models.chat,
        postText,
        auditReport,
        cfg.draft.maxOutputTokens,
        cfg.models.reasoningEffort,
      );
      sendJson(res, 200, { text });
      return;
    }

    logPipeline(`HTTP 404 ${req.method} ${req.url ?? ""} (normalized: ${url})`);
    sendJson(res, 404, { error: "Not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logPipeline(`ERROR: ${msg}`);
    sendJson(res, 500, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`Editor API listening on http://localhost:${PORT}`);
});
