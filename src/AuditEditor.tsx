import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import { PipelinePanel } from './PipelinePanel'

type Pair = { oldText: string; newText: string }
type NoticeTone = 'info' | 'success' | 'error'

type AuditResponse = { auditReport: string; pairs: Pair[] }
type ApplyParsedResponse = {
  text: string
  applied: number
  skippedOldSnippets: string[]
  pairCount: number
  warning?: string
}
type StoredWorkingCopy = {
  article: string
  lastPersistedSnapshot: string
  savedDiskPath: string | null
  savedAt: string
}

const WORKING_COPY_KEY = 'draftloom-working-copy-v1'

function pickText(data: { text?: string; markdown?: string }): string | undefined {
  if (typeof data.text === 'string') return data.text
  if (typeof data.markdown === 'string') return data.markdown
  return undefined
}

async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      response.ok
        ? 'The app returned an unexpected response.'
        : `The local app service could not complete that request (${response.status}).`,
    )
  }
  return (await response.json()) as T
}

function fileLabel(filePath: string | null): string {
  if (!filePath) return ''
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath
}

function downloadName(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() ?? 'draft'
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 52)
  return `${slug || 'draft'}.txt`
}

export function AuditEditor() {
  const [article, setArticle] = useState('')
  const [lastPersistedSnapshot, setLastPersistedSnapshot] = useState('')
  const [savedDiskPath, setSavedDiskPath] = useState<string | null>(null)
  const [auditReport, setAuditReport] = useState('')
  const [pairs, setPairs] = useState<Pair[]>([])
  const [checked, setChecked] = useState<boolean[]>([])
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info')
  const [justUpdatedFromApply, setJustUpdatedFromApply] = useState(false)
  const [postFlash, setPostFlash] = useState(false)
  const [undoArticle, setUndoArticle] = useState<string | null>(null)
  const [copyConfirmed, setCopyConfirmed] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [recoveredAt, setRecoveredAt] = useState<string | null>(null)

  const frozen = busy || pipelineBusy || saveBusy
  const isDirty = article !== lastPersistedSnapshot
  const hasUnsavedWork = Boolean(article.trim() && (!savedDiskPath || isDirty))
  const wordCount = useMemo(
    () => (article.trim() ? article.trim().split(/\s+/).length : 0),
    [article],
  )
  const selectedCount = checked.filter(Boolean).length

  const showNotice = useCallback((message: string, tone: NoticeTone = 'info') => {
    setNotice(message)
    setNoticeTone(tone)
  }, [])

  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        const data = await readApiJson<{ ok?: boolean }>(response)
        setApiOk(response.ok && Boolean(data.ok))
      })
      .catch(() => setApiOk(false))
  }, [])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKING_COPY_KEY)
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredWorkingCopy>
        if (typeof stored.article === 'string' && stored.article.trim()) {
          setArticle(stored.article)
          setLastPersistedSnapshot(
            typeof stored.lastPersistedSnapshot === 'string'
              ? stored.lastPersistedSnapshot
              : stored.article,
          )
          setSavedDiskPath(typeof stored.savedDiskPath === 'string' ? stored.savedDiskPath : null)
          setRecoveredAt(typeof stored.savedAt === 'string' ? stored.savedAt : null)
        }
      }
    } catch {
      window.localStorage.removeItem(WORKING_COPY_KEY)
    } finally {
      setHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const id = window.setTimeout(() => {
      if (!article.trim()) {
        window.localStorage.removeItem(WORKING_COPY_KEY)
        return
      }
      const workingCopy: StoredWorkingCopy = {
        article,
        lastPersistedSnapshot,
        savedDiskPath,
        savedAt: new Date().toISOString(),
      }
      window.localStorage.setItem(WORKING_COPY_KEY, JSON.stringify(workingCopy))
    }, 400)
    return () => window.clearTimeout(id)
  }, [article, hydrated, lastPersistedSnapshot, savedDiskPath])

  useEffect(() => {
    if (!hasUnsavedWork) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnsavedWork])

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
      setRecoveredAt(null)
      setUndoArticle(null)
      clearAuditUi()
      setJustUpdatedFromApply(false)
      showNotice(statusLine, 'success')
      window.setTimeout(() => {
        document.querySelector('#editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    },
    [clearAuditUi, showNotice],
  )

  const saveDraft = useCallback(
    async (strategy: 'prefer-latest' | 'always-new') => {
      if (frozen) return
      if (!article.trim()) {
        showNotice('There is nothing to save yet. Create a draft or start typing first.', 'error')
        return
      }
      setSaveBusy(true)
      showNotice(strategy === 'always-new' ? 'Saving a new version…' : 'Saving your draft…')
      try {
        const response = await fetch('/api/pipeline/save-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: article,
            strategy,
            targetPath: strategy === 'prefer-latest' ? savedDiskPath : null,
          }),
        })
        const data = await readApiJson<{
          path?: string
          kind?: string
          error?: string
        }>(response)
        if (!response.ok) throw new Error(data.error ?? response.statusText)
        const nextPath = typeof data.path === 'string' ? data.path : null
        setLastPersistedSnapshot(article)
        setSavedDiskPath(nextPath)
        setRecoveredAt(null)
        setJustUpdatedFromApply(false)
        showNotice(
          data.kind === 'overwrote'
            ? 'Draft saved. Your file is up to date.'
            : 'Draft saved as a new file in your Draftloom output folder.',
          'success',
        )
      } catch (error) {
        showNotice(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setSaveBusy(false)
      }
    },
    [article, frozen, savedDiskPath, showNotice],
  )

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveDraft('prefer-latest')
      }
    }
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [saveDraft])

  const runAudit = async () => {
    if (frozen) return
    if (!article.trim()) {
      showNotice('Create a draft or add some writing before asking for a review.', 'error')
      return
    }
    setBusy(true)
    showNotice('Your editorial review is in progress…')
    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: article }),
      })
      const data = await readApiJson<AuditResponse & { error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      setAuditReport(data.auditReport)
      setPairs(data.pairs ?? [])
      setChecked((data.pairs ?? []).map(() => true))
      showNotice(
        (data.pairs ?? []).length > 0
          ? `Review ready with ${data.pairs.length} suggested change${data.pairs.length === 1 ? '' : 's'}.`
          : 'Review ready. Open the editorial memo to read the feedback.',
        'success',
      )
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const applyParsed = async () => {
    if (frozen) return
    if (!auditReport.trim()) {
      showNotice('Review the draft first to get suggested edits.', 'error')
      return
    }
    const enabledFlags = pairs.map((_, index) => checked[index] === true)
    if (!enabledFlags.some(Boolean)) {
      showNotice('Select at least one change to apply.', 'error')
      return
    }
    setBusy(true)
    showNotice('Applying your selected edits…')
    try {
      const response = await fetch('/api/apply-parsed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: article, auditReport, enabledFlags }),
      })
      const data = await readApiJson<ApplyParsedResponse & { error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      setUndoArticle(article)
      setArticle(data.text)
      clearAuditUi()
      setJustUpdatedFromApply(true)
      flashPostPane()
      const skipped = data.skippedOldSnippets?.length ?? 0
      showNotice(
        `${data.applied} edit${data.applied === 1 ? '' : 's'} applied${skipped ? `; ${skipped} could not be matched` : ''}. Review the draft, then save when you are happy.`,
        data.applied > 0 ? 'success' : 'error',
      )
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const applyModel = async () => {
    if (frozen) return
    if (!auditReport.trim()) {
      showNotice('Review the draft first to get editorial guidance.', 'error')
      return
    }
    setBusy(true)
    showNotice('Rewriting the full draft from your editorial review…')
    try {
      const response = await fetch('/api/apply-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: article, auditReport }),
      })
      const data = await readApiJson<{ text?: string; markdown?: string; error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      const next = pickText(data)
      if (!next) throw new Error('The rewrite came back empty. Your original draft is unchanged.')
      setUndoArticle(article)
      setArticle(next)
      clearAuditUi()
      setJustUpdatedFromApply(true)
      flashPostPane()
      showNotice('Full rewrite complete. Review the draft, then save when you are happy.', 'success')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const refreshPairsFromReport = async () => {
    if (frozen || !auditReport.trim()) return
    setBusy(true)
    try {
      const response = await fetch('/api/parse-pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditReport }),
      })
      const data = await readApiJson<{ pairs?: Pair[]; error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      setPairs(data.pairs ?? [])
      setChecked((data.pairs ?? []).map(() => true))
      showNotice(`Change list rebuilt with ${(data.pairs ?? []).length} suggestion${data.pairs?.length === 1 ? '' : 's'}.`, 'success')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onerror = () => showNotice(`Could not open ${file.name}.`, 'error')
    reader.onload = () => {
      markPostLoaded(
        String(reader.result ?? ''),
        null,
        `${file.name} is open and backed up locally. Save it to add a copy to Draftloom.`,
      )
    }
    reader.readAsText(file)
  }

  const downloadDraft = () => {
    if (!article.trim()) return
    const url = URL.createObjectURL(new Blob([article], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = downloadName(article)
    anchor.click()
    URL.revokeObjectURL(url)
    showNotice('A copy of your draft was downloaded.', 'success')
  }

  const copyDraft = async () => {
    if (!article.trim()) return
    try {
      await navigator.clipboard.writeText(article)
      setCopyConfirmed(true)
      window.setTimeout(() => setCopyConfirmed(false), 1800)
    } catch {
      showNotice('Could not copy automatically. Select the draft text and copy it manually.', 'error')
    }
  }

  const undoLastEdit = () => {
    if (undoArticle === null) return
    setArticle(undoArticle)
    setUndoArticle(null)
    setJustUpdatedFromApply(false)
    showNotice('The last AI edit was undone.', 'success')
    flashPostPane()
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#create" aria-label="Draftloom home">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <span><strong>Draftloom</strong><small>Author studio</small></span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#create">Create</a>
          <a href="#editor">Editor</a>
          <a href="#guide">Guide</a>
        </nav>
        <div className={`service-status ${apiOk === false ? 'is-offline' : ''}`}>
          <span aria-hidden="true" />
          {apiOk === null ? 'Connecting' : apiOk ? 'Ready' : 'Needs attention'}
        </div>
      </header>

      <main>
        <section className="product-intro">
          <span className="eyebrow">Your private AI writing desk</span>
          <h2>Your books already hold your next great post.</h2>
          <p>Turn the worlds, characters, and ideas you have already written into thoughtful essays your readers will want to open.</p>
          <div className="intro-points">
            <span><i aria-hidden="true">✓</i> Grounded in your manuscripts</span>
            <span><i aria-hidden="true">✓</i> Tuned to your voice</span>
            <span><i aria-hidden="true">✓</i> Saved on your computer</span>
          </div>
        </section>

        <PipelinePanel
          apiOnline={apiOk}
          auditBusy={busy}
          onPipelineBusy={setPipelineBusy}
          onLoadPost={(text, meta) => {
            markPostLoaded(
              text,
              meta?.diskPath ?? null,
              'Your new draft is ready. Edit it below or ask Draftloom for an editorial review.',
            )
          }}
        />

        <section className="editor-section" id="editor">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Refine & export</span>
              <h2>Shape the draft until it sounds like you.</h2>
            </div>
            <p>Your working copy is backed up in this browser as you type.</p>
          </div>

          {recoveredAt && article && (
            <div className="recovery-banner" role="status">
              <span aria-hidden="true">↻</span>
              <div><strong>Working copy restored</strong><small>Draftloom recovered the text from your last session.</small></div>
              <button type="button" onClick={() => setRecoveredAt(null)}>Dismiss</button>
            </div>
          )}

          <div className="editor-grid">
            <article className="draft-panel">
              <header className="panel-header">
                <div>
                  <span className="panel-kicker">Draft</span>
                  <h3>{article.trim() ? fileLabel(savedDiskPath) || 'Untitled working draft' : 'Your post will appear here'}</h3>
                </div>
                <div className="draft-meta">
                  <span>{wordCount.toLocaleString()} words</span>
                  <span className={`save-state ${hasUnsavedWork ? 'is-unsaved' : article ? 'is-saved' : ''}`}>
                    {hasUnsavedWork ? 'Working copy' : article ? 'Saved' : 'Empty'}
                  </span>
                </div>
              </header>

              {justUpdatedFromApply && (
                <div className="edit-success" role="status">
                  <span aria-hidden="true">✦</span>
                  <div><strong>Your draft was updated</strong><small>Read through the changes before saving.</small></div>
                  {undoArticle !== null && <button type="button" onClick={undoLastEdit}>Undo</button>}
                  <button className="icon-dismiss" type="button" aria-label="Dismiss" onClick={() => setJustUpdatedFromApply(false)}>×</button>
                </div>
              )}

              <textarea
                className={`draft-textarea ${postFlash ? 'just-updated' : ''}`}
                value={article}
                onChange={(event) => {
                  setArticle(event.target.value)
                  setCopyConfirmed(false)
                }}
                placeholder={'Your draft starts here…\n\nCreate a post above, open a text file, or simply begin writing.'}
                aria-label="Post draft"
                spellCheck
              />

              <footer className="draft-toolbar">
                <div className="toolbar-primary">
                  <button className="btn-primary" type="button" disabled={frozen || !article.trim()} onClick={() => void saveDraft('prefer-latest')}>
                    {saveBusy ? 'Saving…' : savedDiskPath ? 'Save changes' : 'Save draft'}
                  </button>
                  <button className="btn-soft" type="button" disabled={frozen || !article.trim()} onClick={() => void saveDraft('always-new')}>Save new version</button>
                </div>
                <div className="toolbar-secondary">
                  <button className="icon-button" type="button" disabled={!article.trim()} onClick={() => void copyDraft()}>{copyConfirmed ? 'Copied ✓' : 'Copy'}</button>
                  <button className="icon-button" type="button" disabled={!article.trim()} onClick={downloadDraft}>Download .txt</button>
                  <label className="icon-button file-button">Open file<input type="file" accept=".txt,.text,.md,text/plain" onChange={onFile} /></label>
                </div>
              </footer>
            </article>

            <aside className="review-panel">
              <header className="panel-header">
                <div>
                  <span className="panel-kicker">Editorial review</span>
                  <h3>Polish without losing your voice</h3>
                </div>
                {pairs.length > 0 && <span className="review-count">{pairs.length} edits</span>}
              </header>

              {!auditReport && !busy && (
                <div className="review-empty">
                  <span className="review-orbit" aria-hidden="true">✦</span>
                  <h4>A thoughtful second pair of eyes</h4>
                  <p>Draftloom checks pacing, clarity, repetition, and voice—then lets you approve every change.</p>
                  <button className="btn-dark" type="button" disabled={frozen || !article.trim()} onClick={() => void runAudit()}>Review my draft</button>
                  <small>You stay in control. Nothing is applied automatically.</small>
                </div>
              )}

              {busy && (
                <div className="review-loading" role="status">
                  <span className="review-orbit is-spinning" aria-hidden="true">✦</span>
                  <h4>Reading like an editor…</h4>
                  <p>Long drafts can take a few minutes. Your original text remains untouched.</p>
                  <div className="loading-lines"><span /><span /><span /></div>
                </div>
              )}

              {auditReport && !busy && (
                <div className="review-results">
                  <div className="review-results-head">
                    <p><strong>Review complete</strong><span>{pairs.length > 0 ? 'Choose the edits you want to keep.' : 'Read the editorial memo below.'}</span></p>
                    <button className="text-button" type="button" disabled={frozen} onClick={() => void runAudit()}>Review again</button>
                  </div>

                  {pairs.length > 0 && (
                    <>
                      <div className="selection-tools">
                        <span>{selectedCount} of {pairs.length} selected</span>
                        <div><button type="button" onClick={() => setChecked(pairs.map(() => true))}>Select all</button><button type="button" onClick={() => setChecked(pairs.map(() => false))}>Clear</button></div>
                      </div>
                      <ul className="change-list">
                        {pairs.map((pair, index) => (
                          <li key={`${pair.oldText}-${index}`} className={checked[index] ? 'is-selected' : ''}>
                            <label>
                              <input
                                type="checkbox"
                                checked={checked[index] ?? false}
                                onChange={() => setChecked((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value))}
                              />
                              <span>Change {index + 1}</span>
                            </label>
                            <div className="change-copy old-copy"><small>Current</small><p>{pair.oldText}</p></div>
                            <div className="change-copy new-copy"><small>Suggested</small><p>{pair.newText || <em>Remove this sentence</em>}</p></div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <div className="review-actions">
                    <button className="btn-primary" type="button" disabled={frozen || selectedCount === 0} onClick={() => void applyParsed()}>Apply {selectedCount || ''} selected {selectedCount === 1 ? 'edit' : 'edits'}</button>
                    <button className="btn-soft" type="button" disabled={frozen} onClick={() => void applyModel()}>Rewrite full draft</button>
                  </div>

                  <details className="editorial-memo">
                    <summary>Read or edit the full editorial memo</summary>
                    <textarea value={auditReport} onChange={(event) => setAuditReport(event.target.value)} spellCheck={false} aria-label="Editorial memo" />
                    <button type="button" disabled={frozen || !auditReport.trim()} onClick={() => void refreshPairsFromReport()}>Rebuild edit list from memo</button>
                  </details>
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className="guide-section" id="guide">
          <div><span className="eyebrow">A simple rhythm</span><h2>From manuscript to newsletter in three moves.</h2></div>
          <ol>
            <li><span>01</span><div><strong>Add your books once</strong><p>Draftloom keeps a private local library and refreshes it only when your files change.</p></div></li>
            <li><span>02</span><div><strong>Describe the idea, not the headline</strong><p>Give a theme, angle, scene, or question. Draftloom builds the title and structure for you.</p></div></li>
            <li><span>03</span><div><strong>Edit, review, and export</strong><p>Approve individual suggestions, save versions, then copy or download the finished post.</p></div></li>
          </ol>
        </section>

        {notice && (
          <div className={`app-notice notice-${noticeTone}`} role="status" aria-live="polite">
            <span aria-hidden="true">{noticeTone === 'success' ? '✓' : noticeTone === 'error' ? '!' : '●'}</span>
            <p>{notice}</p>
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button>
          </div>
        )}
      </main>

      <footer className="site-footer">
        <a className="brand" href="#create"><span className="brand-mark" aria-hidden="true">✦</span><span><strong>Draftloom</strong><small>Made for independent authors</small></span></a>
        <p>Your words. Your worlds. Your computer.</p>
      </footer>
    </div>
  )
}
