import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

export type PipelineStatus = {
  booksPath: string
  chunkCount: number
  embeddedCount: number
  latestDraftPath: string | null
  outputDir: string
}

export type LoadPostMeta = {
  /** Server path when loaded from generate / Reload from disk; omit when unknown (e.g. local Open…). */
  diskPath?: string | null
}

type Props = {
  auditBusy: boolean
  onPipelineBusy: (busy: boolean) => void
  onLoadPost: (text: string, meta?: LoadPostMeta) => void
}

function pushLocal(
  setLocal: Dispatch<SetStateAction<string[]>>,
  line: string,
) {
  const ts = new Date().toLocaleTimeString()
  setLocal((prev) => [...prev.slice(-40), `[${ts}] ${line}`])
}

const MIN_TOPIC_PROMPT_LEN = 12

function pickDraftText(data: Record<string, unknown>): string | null {
  const d = data as {
    text?: string
    markdown?: string
    draft?: { text?: string; markdown?: string }
  }
  const candidates = [d.text, d.markdown, d.draft?.text, d.draft?.markdown]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return null
}

export function PipelinePanel({
  auditBusy,
  onPipelineBusy,
  onLoadPost,
}: Props) {
  const [status, setStatus] = useState<PipelineStatus | null>(null)
  const [serverLines, setServerLines] = useState<string[]>([])
  const [localNotes, setLocalNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [topicPrompt, setTopicPrompt] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const logEndRef = useRef<HTMLPreElement>(null)

  const fetchServerLog = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline/log')
      const data = (await r.json()) as { lines?: string[] }
      if (r.ok && Array.isArray(data.lines)) setServerLines(data.lines)
    } catch {
      /* ignore */
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline/status')
      const data = (await r.json()) as PipelineStatus & { error?: string }
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      setStatus(data)
    } catch (e) {
      pushLocal(
        setLocalNotes,
        `Status error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!busy) return
    setLogOpen(true)
    void fetchServerLog()
    const id = window.setInterval(() => void fetchServerLog(), 1000)
    return () => window.clearInterval(id)
  }, [busy, fetchServerLog])

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollTop = logEndRef.current.scrollHeight
    }
  }, [serverLines, localNotes])

  const run = async (label: string, path: string, body?: object) => {
    if (auditBusy || busy) return
    setBusy(true)
    onPipelineBusy(true)
    pushLocal(setLocalNotes, `${label}: started.`)
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = (await r.json()) as Record<string, unknown> & {
        error?: string
        pipelineLogLines?: string[]
        draftTopicPreview?: string
      }
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      if (Array.isArray(data.pipelineLogLines) && data.pipelineLogLines.length > 0) {
        setServerLines(data.pipelineLogLines)
      }
      if (typeof data.draftTopicPreview === 'string' && data.draftTopicPreview.length > 0) {
        pushLocal(
          setLocalNotes,
          `Topic used: ${data.draftTopicPreview.length > 160 ? `${data.draftTopicPreview.slice(0, 160)}…` : data.draftTopicPreview}`,
        )
      }
      await fetchServerLog()
      const d = data as {
        filePath?: string
        outputPath?: string
        draft?: { filePath?: string }
      }
      const savedPath =
        typeof d.filePath === 'string'
          ? d.filePath
          : typeof d.draft?.filePath === 'string'
            ? d.draft.filePath
            : undefined
      if (savedPath) {
        pushLocal(setLocalNotes, `Wrote ${savedPath}`)
      }
      if (typeof d.outputPath === 'string') {
        pushLocal(setLocalNotes, `Wrote ${d.outputPath}`)
      }
      const meta = data as {
        indexDir?: string
        vectorCount?: number
        bookChunks?: number
        voiceChunks?: number
      }
      if (typeof meta.vectorCount === 'number') {
        pushLocal(
          setLocalNotes,
          `Prepared ${meta.vectorCount} passages so the writer can use your sources.`,
        )
      }
      if (typeof meta.bookChunks === 'number') {
        pushLocal(
          setLocalNotes,
          `Indexed ${meta.bookChunks} snippets from books, ${meta.voiceChunks ?? 0} from voice samples.`,
        )
      }
      const draftText = pickDraftText(data)
      if (
        draftText &&
        (path === '/api/pipeline/draft' || path === '/api/pipeline/full')
      ) {
        onLoadPost(draftText, savedPath !== undefined ? { diskPath: savedPath } : undefined)
        pushLocal(
          setLocalNotes,
          'Your draft appeared in the big box on the left. Use “Save draft to disk” there when you are done editing.',
        )
      }
      await refreshStatus()
    } catch (e) {
      pushLocal(
        setLocalNotes,
        `${label} failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      await fetchServerLog()
    } finally {
      await fetchServerLog()
      setBusy(false)
      onPipelineBusy(false)
    }
  }

  const loadLatest = async () => {
    if (auditBusy || busy) return
    setBusy(true)
    onPipelineBusy(true)
    pushLocal(setLocalNotes, 'Loading your most recent saved draft…')
    try {
      const r = await fetch('/api/pipeline/latest-draft')
      const data = (await r.json()) as {
        path?: string
        content?: string
        error?: string
      }
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      if (typeof data.content === 'string') {
        onLoadPost(data.content, { diskPath: data.path ?? null })
        pushLocal(setLocalNotes, `Reloaded ${data.path ?? 'draft'}`)
      }
    } catch (e) {
      pushLocal(
        setLocalNotes,
        `Reload failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setBusy(false)
      onPipelineBusy(false)
    }
  }

  const promptTrim = topicPrompt.trim()
  const promptOk = promptTrim.length >= MIN_TOPIC_PROMPT_LEN
  const embedReady =
    status !== null && status.embeddedCount > 0 && status.chunkCount > 0

  const runDraft = () => {
    if (!promptOk) {
      pushLocal(
        setLocalNotes,
        `Describe the post (at least ${MIN_TOPIC_PROMPT_LEN} characters).`,
      )
      return
    }
    void run('Write draft post', '/api/pipeline/draft', {
      customTopicPrompt: promptTrim,
    })
  }

  const runFull = () => {
    if (!promptOk) {
      pushLocal(
        setLocalNotes,
        `Describe the post (at least ${MIN_TOPIC_PROMPT_LEN} characters).`,
      )
      return
    }
    void run('Do all steps automatically', '/api/pipeline/full', {
      customTopicPrompt: promptTrim,
    })
  }

  const disabled = auditBusy || busy

  const logText =
    serverLines.length > 0
      ? serverLines.join('\n')
      : 'Nothing to show yet. Use the buttons above, or keep this open while the app is working.'

  const localBlock =
    localNotes.length > 0 ? `\n\n--- notes ---\n${localNotes.join('\n')}` : ''

  return (
    <section className="pipeline-shell">
      <div className="pipeline-shell-head">
        <h2 className="pipeline-shell-title">Load your books, then generate a post</h2>
        <button
          type="button"
          className="btn-ghost"
          disabled={disabled}
          onClick={refreshStatus}
          title="Updates the counts and folder path below without running anything."
        >
          Update numbers
        </button>
      </div>

      {status && (
        <p className="pipeline-stats-line">
          <span title="Pieces of your manuscripts the app has read in.">
            {status.chunkCount} text snippets from your files
          </span>
          <span className="pipeline-stats-sep">·</span>
          <span title="Snippets the writer can actually use when you click Generate.">
            {status.embeddedCount} ready for writing
          </span>
          <span className="pipeline-stats-sep">·</span>
          <span className="pipeline-stats-path" title={status.outputDir}>
            saved drafts folder: {status.outputDir}
          </span>
        </p>
      )}

      <div className="pipeline-groups">
        <div className="pipeline-group">
          <span className="pipeline-group-label">Step 1 — Read your source files</span>
          <div className="pipeline-group-btns">
            <button
              type="button"
              disabled={disabled}
              title="Use when you changed Word manuscripts (.docx) in your books folder."
              onClick={() => run('Scan my Word books', '/api/pipeline/ingest-books')}
            >
              Scan my Word books (.docx)
            </button>
            <button
              type="button"
              disabled={disabled}
              title="Use when you added or changed sample writing under data/voice."
              onClick={() => run('Scan my writing samples', '/api/pipeline/ingest-voice')}
            >
              Scan my writing samples
            </button>
            <button
              type="button"
              disabled={disabled}
              title="Re-read everything. Use for a full refresh; can take a long time."
              onClick={() => run('Scan everything', '/api/pipeline/ingest')}
            >
              Scan everything (slow)
            </button>
          </div>
        </div>
        <div className="pipeline-group">
          <span className="pipeline-group-label">Step 2 — Enable “Write draft post”</span>
          <div className="pipeline-group-btns">
            <button
              type="button"
              disabled={disabled}
              title="Run this after any scan in Step 1. Without this, Generate stays disabled."
              onClick={() => run('Connect sources to the writer', '/api/pipeline/embed')}
            >
              Connect sources to the writer
            </button>
          </div>
        </div>
      </div>

      <div className="pipeline-generate">
        <label className="pipeline-generate-label" htmlFor="pipeline-topic-prompt">
          Step 3 — Describe the post you want (topic, angle, what to emphasize)
        </label>
        <textarea
          id="pipeline-topic-prompt"
          className="pipeline-topic-prompt"
          rows={4}
          disabled={disabled}
          value={topicPrompt}
          onChange={(e) => setTopicPrompt(e.target.value)}
          placeholder="Example: A post about grief and memory, pulling themes from the novel; warm tone; mention the river metaphor. You are giving directions — the app still writes the headline and body."
        />
        <div className="pipeline-generate-actions">
          <button
            type="button"
            disabled={disabled || !embedReady || !promptOk}
            onClick={runDraft}
            title="Writes a new draft using your books (after Steps 1–2) and opens it in the editor on the left."
          >
            Write draft post
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled || !promptOk}
            onClick={runFull}
            title="Does Step 1 (full scan), Step 2, and this draft in one go. Longer wait; use if you are unsure what ran last."
          >
            Do all steps automatically (slow)
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={loadLatest}
            title="Loads the most recent saved .txt from your output folder into the editor — e.g. after refreshing the page."
          >
            Open last saved draft from disk
          </button>
          {!embedReady && status !== null && (
            <span className="pipeline-inline-hint">
              First run Step 1 (scan), then Step 2 (connect). Then this button unlocks.
            </span>
          )}
          {embedReady && !promptOk && (
            <span className="pipeline-inline-hint">
              Type at least {MIN_TOPIC_PROMPT_LEN} characters in the box above so the app knows what to write.
            </span>
          )}
        </div>
      </div>

      <details className="pipeline-help">
        <summary>Simple guide — which button when?</summary>
        <ul>
          <li>
            <strong>Scan my Word books</strong> — you edited or replaced manuscript <code>.docx</code> files.
          </li>
          <li>
            <strong>Scan my writing samples</strong> — you changed files under <code>data/voice</code> (faster than re-scanning all books).
          </li>
          <li>
            <strong>Scan everything</strong> — you want a full refresh of all sources; can take a while.
          </li>
          <li>
            <strong>Connect sources to the writer</strong> — always click this after a scan so “Write draft post” can run.
          </li>
          <li>
            <strong>Write draft post</strong> — saves a plain <code>.txt</code> in your output folder and fills the big editor on the left. To polish wording, use the right-hand suggestions panel, then{' '}
            <strong>Save draft to disk</strong> on the left.
          </li>
          <li>
            <strong>Open last saved draft from disk</strong> — you reloaded the page or edited the file in another program.
          </li>
        </ul>
        <p className="pipeline-help-foot">
          The app talks to OpenAI; put <code>OPENAI_API_KEY</code> in <code>.env</code>. Your Word files are read from (config{' '}
          <code>paths.books</code> or env <code>PIPELINE_BOOKS</code>):{' '}
          {status?.booksPath ?? '…'}
        </p>
      </details>

      <details
        className="pipeline-log-details"
        open={logOpen}
        onToggle={(e) => setLogOpen(e.currentTarget.open)}
      >
        <summary>Technical details (optional)</summary>
        <p className="pipeline-log-lede">
          {busy
            ? 'Working… this list updates about every second if you leave it open.'
            : 'Idle — nothing running right now.'}{' '}
          For troubleshooting; you can ignore this if the app behaves as expected.
        </p>
        <pre ref={logEndRef} className="pipeline-log" aria-live="polite">
          {logText}
          {localBlock}
        </pre>
      </details>
    </section>
  )
}
