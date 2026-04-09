VOICE / STYLE ANCHORS (optional but recommended)
==============================================

Put files here so the pipeline can retrieve your real writing cadence when
outlining, drafting, and revising. Paths come from pipeline.config.json
(key: paths.voice) — default is this folder.

WHAT TO ADD
-----------
• .docx — Word exports of posts (same as before), OR
• .txt — UTF-8 plain text: paste full posts verbatim, one file per post.
  Example names: echoes-serafim-data-angels.txt, rayna-hall-of-reflections.txt

Use a few of your strongest pieces (like your long analytical essays). More text
helps; duplicates don’t hurt much.

LENGTH OF *GENERATED* POSTS
----------------------------
Voice files control rhythm and diction, not an exact word count. Target length
for new drafts is set in pipeline.config.json under draft.minWordCount
(default 800). If your anchor posts are ~2000–3000 words and you want drafts
closer to that, raise minWordCount (and consider draft.maxOutputTokens if the
model truncates).

AFTER YOU ADD OR CHANGE VOICE FILES ONLY
----------------------------------------
Use "Ingest voice" (UI 1b, or: npm run ingest:voice). That re-chunks only this
folder and keeps existing book chunks — no need to re-ingest the whole series.
Then run Embed (2) so new voice chunks get vectors.

After you change BOOK manuscripts, use "Ingest books" (1a / npm run ingest:books).

"Ingest all" (1) rescans books + voice; use when you want a full refresh (slow).

If this folder is empty or missing, ingest-voice still succeeds with 0 voice
chunks; drafts fall back to neutral voice retrieval.
