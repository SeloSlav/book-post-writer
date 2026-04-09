import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
} from 'react'
import { PipelinePanel } from './PipelinePanel'

type Pair = { oldText: string; newText: string }

type AuditResponse = { auditReport: string; pairs: Pair[] }

type ApplyParsedResponse = {
  text: string
  applied: number
  skippedOldSnippets: string[]
  pairCount: number
  warning?: string
}

function pickText(data: { text?: string; markdown?: string }): string | undefined {
  if (typeof data.text === 'string') return data.text
  if (typeof data.markdown === 'string') return data.markdown
  return undefined
}

export function AuditEditor() {
  const [article, setArticle] = useState('')
  /** Last text that matches the file on disk (or last load); differs from article when there are unsaved edits. */
  const [lastPersistedSnapshot, setLastPersistedSnapshot] = useState('')
  const [savedDiskPath, setSavedDiskPath] = useState<string | null>(null)
  const [auditReport, setAuditReport] = useState('')
  const [pairs, setPairs] = useState<Pair[]>([])
  const [checked, setChecked] = useState<boolean[]>([])
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [justUpdatedFromApply, setJustUpdatedFromApply] = useState(false)
  const [postFlash, setPostFlash] = useState(false)
  const frozen = busy || pipelineBusy || saveBusy

  const isDirty = article !== lastPersistedSnapshot

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApiOk(!!d?.ok))
      .catch(() => setApiOk(false))
  }, [])

  const clearAuditUi = useCallback(() => {
    setAuditReport('')
    setPairs([])
    setChecked([])
  }, [])

  const flashPostPane = useCallback(() => {
    setPostFlash(true)
    window.setTimeout(() => setPostFlash(false), 1400)
  }, [])

  const markPostLoaded = useCallback(
    (text: string, diskPath: string | null, statusLine: string) => {
      setArticle(text)
      setLastPersistedSnapshot(text)
      setSavedDiskPath(diskPath)
      clearAuditUi()
      setJustUpdatedFromApply(false)
      setStatus(statusLine)
    },
    [clearAuditUi],
  )

  const saveDraft = async (strategy: 'prefer-latest' | 'always-new') => {
    if (frozen) return
    if (!article.trim()) {
      setStatus('Nothing to save yet — type something or use “Write draft post” up top first.')
      return
    }
    setSaveBusy(true)
    setStatus(strategy === 'always-new' ? 'Saving new file…' : 'Saving to disk…')
    try {
      const r = await fetch('/api/pipeline/save-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: article, strategy }),
      })
      let data: {
        path?: string
        kind?: string
        error?: string
        pipelineLogLines?: string[]
      } = {}
      try {
        data = (await r.json()) as typeof data
      } catch {
        if (!r.ok) {
          throw new Error(
            r.status === 404
              ? 'Save route not found — restart the app with npm run dev (or npm run editor-api) so the API includes save-draft. If you use vite preview only, the API is not available.'
              : `Save failed (${r.status} ${r.statusText}). The editor API may be offline.`,
          )
        }
        throw new Error('Invalid response from server.')
      }
      if (!r.ok) {
        throw new Error(
          data.error ??
            (r.status === 404
              ? 'Not found — restart npm run dev so the editor API picks up the latest routes.'
              : r.statusText),
        )
      }
      const p = typeof data.path === 'string' ? data.path : ''
      setLastPersistedSnapshot(article)
      setSavedDiskPath(p)
      setJustUpdatedFromApply(false)
      const kind =
        data.kind === 'overwrote'
          ? 'Updated existing draft file.'
          : 'Created a new file in the output folder.'
      setStatus(`${kind} ${p ? `→ ${p}` : ''}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveBusy(false)
    }
  }

  const runAudit = async () => {
    if (frozen) return
    if (!article.trim()) {
      setStatus('Add text to your draft first — use “Write draft post” up top, “Open last saved draft”, paste, or “Open file…”.')
      return
    }
    setBusy(true)
    setStatus('Getting writing suggestions…')
    try {
      const r = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: article }),
      })
      const data = (await r.json()) as AuditResponse & { error?: string }
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      setAuditReport(data.auditReport)
      setPairs(data.pairs ?? [])
      setChecked((data.pairs ?? []).map(() => true))
      setStatus(
        `Suggestions ready. ${(data.pairs ?? []).length} specific text change(s) listed on the right — check the boxes you want.`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyParsed = async () => {
    if (frozen) return
    if (!auditReport.trim()) {
      setStatus('Click “Get writing suggestions” first (under your draft on the left).')
      return
    }
    const enabledFlags = pairs.map((_, i) => checked[i] === true)
    if (!enabledFlags.some(Boolean)) {
      setStatus('Turn on at least one checkbox on the right, or use “Rewrite whole draft with AI”.')
      return
    }
    setBusy(true)
    setStatus('Updating your draft with the checked changes…')
    try {
      const r = await fetch('/api/apply-parsed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: article,
          auditReport,
          enabledFlags,
        }),
      })
      const data = (await r.json()) as ApplyParsedResponse & { error?: string }
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      setArticle(data.text)
      clearAuditUi()
      setJustUpdatedFromApply(true)
      flashPostPane()
      const skip =
        data.skippedOldSnippets?.length > 0
          ? ` Skipped (not found): ${data.skippedOldSnippets.length}.`
          : ''
      const warn = data.warning ? ` ${data.warning}` : ''
      setStatus(
        `Updated your draft with ${data.applied} change(s).${skip}${warn} Click “Save draft to disk” on the left if you want the file on your computer updated. Click “Get writing suggestions” again if you want another pass.`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyModel = async () => {
    if (frozen) return
    if (!auditReport.trim()) {
      setStatus('Click “Get writing suggestions” first (under your draft on the left).')
      return
    }
    setBusy(true)
    setStatus('Rewriting your whole draft with AI (using the suggestions text)…')
    try {
      const r = await fetch('/api/apply-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: article, auditReport }),
      })
      const data = (await r.json()) as { text?: string; markdown?: string; error?: string }
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      const next = pickText(data)
      if (next) {
        setArticle(next)
        clearAuditUi()
        setJustUpdatedFromApply(true)
        flashPostPane()
        setStatus(
          'Your full draft on the left was rewritten. Click “Save draft to disk” if you want the file updated. Click “Get writing suggestions” again for another pass.',
        )
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleAll = (on: boolean) => {
    setChecked(pairs.map(() => on))
  }

  const refreshPairsFromReport = async () => {
    if (frozen) return
    if (!auditReport.trim()) {
      setStatus('The suggestions box on the right is empty — run “Get writing suggestions” first.')
      return
    }
    setBusy(true)
    try {
      const r = await fetch('/api/parse-pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditReport }),
      })
      const data = (await r.json()) as { pairs?: Pair[]; error?: string }
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      setPairs(data.pairs ?? [])
      setChecked((data.pairs ?? []).map(() => true))
      setStatus(`Refreshed the list: ${(data.pairs ?? []).length} change(s) from the suggestions box.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const t = String(reader.result ?? '')
      markPostLoaded(
        t,
        null,
        `Opened “${f.name}” from your computer. Click “Save draft to disk” to copy it into this project’s output folder.`,
      )
    }
    reader.readAsText(f)
  }

  return (
    <div className="audit-editor">
      <header className="audit-header">
        <h1>Book → post writer</h1>
        <p className="audit-lede">
          Turn your Word manuscripts into a Substack-style post: use the <strong>top section</strong> to load books and
          create a draft, then use the <strong>right column</strong> for line-by-line wording fixes (optional).
        </p>
        <p className="audit-meta">
          App backend{' '}
          {apiOk === null
            ? '…'
            : apiOk
              ? 'is running'
              : 'is offline — from the project folder run npm run dev (needs the small server on port 8787)'}
        </p>
      </header>

      <PipelinePanel
        auditBusy={busy}
        onPipelineBusy={setPipelineBusy}
        onLoadPost={(text, meta) => {
          const path = meta?.diskPath ?? null
          markPostLoaded(
            text,
            path,
            path
              ? 'Draft loaded from your saved-drafts folder. After you edit wording, click “Save draft to disk” on the left so the file updates.'
              : 'Draft text loaded. Use “Get writing suggestions” on the left when you want wording tips — then save if the file should match.',
          )
        }}
      />

      <div className="audit-grid">
        <section className="audit-panel audit-panel-post">
          <h2>Your post draft</h2>
          <p className="audit-post-lede">
            This big box is what you edit. <strong>Apply checked changes</strong> and <strong>Rewrite whole draft with AI</strong> update this
            text right away. The file on your computer only updates when you click <strong>Save draft to disk</strong>.
          </p>
          {justUpdatedFromApply && (
            <div className="audit-post-callout audit-post-callout--success" role="status">
              <strong>Your draft below was just updated</strong> — scroll the big text box if you do not see the change.{' '}
              <button
                type="button"
                className="audit-callout-dismiss"
                onClick={() => setJustUpdatedFromApply(false)}
              >
                Dismiss
              </button>
            </div>
          )}
          {isDirty && (
            <div className="audit-post-callout audit-post-callout--warn" role="status">
              <strong>You have unsaved edits</strong> — they exist only in the browser until you click{' '}
              <strong>Save draft to disk</strong> or <strong>Save as a new file</strong>.
            </div>
          )}
          {!isDirty && savedDiskPath && (
            <p className="audit-post-sync-hint">
              Same as the file on your computer: <code className="audit-path-code">{savedDiskPath}</code>
            </p>
          )}
          <textarea
            className={`audit-textarea${postFlash ? ' audit-textarea--just-updated' : ''}`}
            value={article}
            onChange={(e) => setArticle(e.target.value)}
            placeholder="Plain text, normal paragraphs. This fills when you click “Write draft post” up top, or “Open last saved draft”, or “Open file…”."
            spellCheck={true}
          />
          <div className="audit-toolbar audit-toolbar-save">
            <button
              type="button"
              className="audit-btn-save"
              disabled={frozen || !article.trim()}
              onClick={() => void saveDraft('prefer-latest')}
              title="Updates your most recent draft file in the output folder, or creates one if you have never saved."
            >
              Save draft to disk
            </button>
            <button
              type="button"
              className="audit-btn-secondary"
              disabled={frozen || !article.trim()}
              onClick={() => void saveDraft('always-new')}
              title="Always creates a brand-new file with today’s date/time in the name — keeps older versions."
            >
              Save as a new file
            </button>
          </div>
          <div className="audit-toolbar">
            <label
              className="audit-file-label"
              title="Pick a .txt or .md file from your computer to load into the draft box."
            >
              Open file from computer…
              <input type="file" accept=".txt,.text,.md,text/plain" onChange={onFile} />
            </label>
            <button
              type="button"
              disabled={frozen}
              onClick={runAudit}
              title="Asks the app to compare your draft to your books’ style and list concrete word-level fixes on the right."
            >
              Get writing suggestions
            </button>
          </div>
        </section>

        <section className="audit-panel">
          <h2>Suggestions & edits</h2>
          <p className="audit-suggestions-lede">
            After you click <strong>Get writing suggestions</strong>, a report appears here. You can edit the text before applying changes to your draft.
          </p>
          <textarea
            className="audit-textarea audit-report"
            value={auditReport}
            onChange={(e) => setAuditReport(e.target.value)}
            placeholder="The suggestion report shows up here. Edit it if you need to, then use the buttons below."
            spellCheck={false}
          />
          <div className="audit-pairs-toolbar">
            <button
              type="button"
              disabled={frozen || !auditReport.trim()}
              onClick={refreshPairsFromReport}
              title="Rebuilds the checklist below from whatever is currently in the report box — use if you edited the report by hand."
            >
              Rebuild change list from report
            </button>
          </div>
          {pairs.length > 0 && (
            <div className="audit-pairs">
              <div className="audit-pairs-head">
                <span>Suggested text swaps</span>
                <button type="button" onClick={() => toggleAll(true)} title="Check every suggestion.">
                  Check all
                </button>
                <button type="button" onClick={() => toggleAll(false)} title="Uncheck every suggestion.">
                  Uncheck all
                </button>
              </div>
              <ul className="audit-pair-list">
                {pairs.map((p, i) => (
                  <li key={i} className="audit-pair">
                    <label>
                      <input
                        type="checkbox"
                        checked={checked[i] ?? false}
                        onChange={() =>
                          setChecked((c) => {
                            const n = [...c]
                            n[i] = !n[i]
                            return n
                          })
                        }
                      />
                      <span className="audit-pair-i">#{i + 1}</span>
                    </label>
                    <div className="audit-diff">
                      <div>
                        <strong>Current wording</strong>
                        <pre>{p.oldText}</pre>
                      </div>
                      <div>
                        <strong>Suggested wording</strong>
                        <pre>{p.newText}</pre>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="audit-actions">
            <button
              type="button"
              disabled={busy}
              onClick={applyParsed}
              title="Finds each checked “current wording” in your draft and replaces it with the “suggested wording”."
            >
              Apply checked changes to draft
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={applyModel}
              title="Sends your whole draft plus the suggestion report to the AI for one full rewrite (different from swapping individual phrases)."
            >
              Rewrite whole draft with AI
            </button>
          </div>
          <details className="audit-help-details">
            <summary>What do these two buttons do?</summary>
            <p className="audit-hint">
              <strong>Apply checked changes</strong> only swaps the exact phrases you ticked — like find-and-replace.{' '}
              <strong>Rewrite whole draft with AI</strong> rewrites the entire post in one go using the report as guidance.
              Neither button saves a file — use <strong>Save draft to disk</strong> on the left when you are happy. Click{' '}
              <strong>Get writing suggestions</strong> again on the new text if you want more ideas.
            </p>
          </details>
        </section>
      </div>

      {status && <p className="audit-status">{status}</p>}
    </div>
  )
}
