import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react'

export type PipelineStatus = {
  booksPath: string
  bookFileCount: number
  bookGroups: Array<{ name: string; count: number }>
  voiceFileCount: number
  chunkCount: number
  embeddedCount: number
  sourcesNeedScan: boolean
  embeddingsNeedRefresh: boolean
  apiKeyConfigured: boolean
  chatModel: string
  latestDraftPath: string | null
  outputDir: string
}

export type LoadPostMeta = {
  diskPath?: string | null
}

type Props = {
  apiOnline: boolean | null
  auditBusy: boolean
  onPipelineBusy: (busy: boolean) => void
  onLoadPost: (text: string, meta?: LoadPostMeta) => void
}

type ApiRecord = Record<string, unknown> & { error?: string }

const MIN_TOPIC_PROMPT_LEN = 12
const PROMPT_STARTERS = [
  'The hidden cost of keeping a family secret',
  'What this character taught me about starting over',
  'A scene that changed how I think about belonging',
]

function pushLocal(
  setLocal: Dispatch<SetStateAction<string[]>>,
  line: string,
) {
  const ts = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  setLocal((prev) => [...prev.slice(-40), `[${ts}] ${line}`])
}

async function readApiJson<T extends ApiRecord>(response: Response): Promise<T> {
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

function pickDraftText(data: ApiRecord): string | null {
  const draft = data.draft as { text?: string; markdown?: string } | undefined
  const candidates = [data.text, data.markdown, draft?.text, draft?.markdown]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      if (comma === -1) reject(new Error(`Could not prepare ${file.name}.`))
      else resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

export function PipelinePanel({
  apiOnline,
  auditBusy,
  onPipelineBusy,
  onLoadPost,
}: Props) {
  const [status, setStatus] = useState<PipelineStatus | null>(null)
  const [serverLines, setServerLines] = useState<string[]>([])
  const [localNotes, setLocalNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [activeAction, setActiveAction] = useState('')
  const [topicPrompt, setTopicPrompt] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [booksPathDraft, setBooksPathDraft] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const logEndRef = useRef<HTMLPreElement>(null)

  const fetchServerLog = useCallback(async () => {
    try {
      const response = await fetch('/api/pipeline/log')
      const data = await readApiJson<{ lines?: string[]; error?: string }>(response)
      if (response.ok && Array.isArray(data.lines)) setServerLines(data.lines)
    } catch {
      // The activity log is optional and should never block the main flow.
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/pipeline/status')
      const data = await readApiJson<PipelineStatus & { error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      setStatus(data)
    } catch (error) {
      pushLocal(
        setLocalNotes,
        `Could not refresh setup: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }, [])

  useEffect(() => {
    if (apiOnline !== false) void refreshStatus()
  }, [apiOnline, refreshStatus])

  useEffect(() => {
    if (status?.booksPath) setBooksPathDraft(status.booksPath)
  }, [status?.booksPath])

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

  const run = async (label: string, endpoint: string, body?: object) => {
    if (auditBusy || busy || keySaving) return
    setBusy(true)
    setActiveAction(label)
    onPipelineBusy(true)
    pushLocal(setLocalNotes, `${label} started.`)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = await readApiJson<ApiRecord & {
        pipelineLogLines?: string[]
        draftTopicPreview?: string
      }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      if (Array.isArray(data.pipelineLogLines) && data.pipelineLogLines.length > 0) {
        setServerLines(data.pipelineLogLines)
      }
      const draft = data.draft as { filePath?: string } | undefined
      const savedPath =
        typeof data.filePath === 'string'
          ? data.filePath
          : typeof draft?.filePath === 'string'
            ? draft.filePath
            : undefined
      const draftText = pickDraftText(data)
      if (draftText && (endpoint.endsWith('/draft') || endpoint.endsWith('/full'))) {
        onLoadPost(draftText, savedPath ? { diskPath: savedPath } : undefined)
        pushLocal(setLocalNotes, 'Draft ready — it is open in the editor below.')
      } else {
        pushLocal(setLocalNotes, `${label} finished.`)
      }
      await refreshStatus()
    } catch (error) {
      pushLocal(
        setLocalNotes,
        `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      await fetchServerLog()
    } finally {
      await fetchServerLog()
      setBusy(false)
      setActiveAction('')
      onPipelineBusy(false)
    }
  }

  const saveApiKey = async () => {
    const cleanKey = apiKey.trim()
    if (!cleanKey) return
    setKeySaving(true)
    onPipelineBusy(true)
    try {
      const response = await fetch('/api/settings/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: cleanKey }),
      })
      const data = await readApiJson<{ ok?: boolean; error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      setApiKey('')
      pushLocal(setLocalNotes, 'OpenAI connected. Your key stays in this app folder.')
      await refreshStatus()
    } catch (error) {
      pushLocal(
        setLocalNotes,
        `Could not connect OpenAI: ${error instanceof Error ? error.message : String(error)}`,
      )
      setLogOpen(true)
    } finally {
      setKeySaving(false)
      onPipelineBusy(false)
    }
  }

  const uploadFiles = async (kind: 'book' | 'voice', selected: FileList | null) => {
    if (!selected || selected.length === 0 || auditBusy || busy || keySaving) return
    const allowedExtensions = kind === 'book' ? ['.docx'] : ['.docx', '.txt']
    const selectedFiles = Array.from(selected)
    const files = selectedFiles.filter((file) =>
      allowedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)),
    )
    if (files.length === 0) {
      pushLocal(
        setLocalNotes,
        kind === 'book' ? 'No Word .docx files were found in that selection.' : 'No .docx or .txt files were found in that selection.',
      )
      setLogOpen(true)
      return
    }
    if (files.length > 200) {
      pushLocal(setLocalNotes, 'Choose a folder with no more than 200 supported files at a time.')
      setLogOpen(true)
      return
    }
    const oversized = files.find((file) => file.size > 15 * 1024 * 1024)
    if (oversized) {
      pushLocal(setLocalNotes, `${oversized.name} is larger than the 15 MB file limit.`)
      setLogOpen(true)
      return
    }
    const label = kind === 'book' ? 'Adding manuscripts' : 'Adding voice samples'
    setBusy(true)
    setActiveAction(label)
    onPipelineBusy(true)
    try {
      const batches: File[][] = []
      let batch: File[] = []
      let batchBytes = 0
      for (const file of files) {
        if (batch.length >= 40 || (batch.length > 0 && batchBytes + file.size > 20 * 1024 * 1024)) {
          batches.push(batch)
          batch = []
          batchBytes = 0
        }
        batch.push(file)
        batchBytes += file.size
      }
      if (batch.length > 0) batches.push(batch)

      let uploaded = 0
      for (const [batchIndex, currentBatch] of batches.entries()) {
        setActiveAction(`${label} (${batchIndex + 1}/${batches.length})`)
        const payload = await Promise.all(
          currentBatch.map(async (file) => ({
            name: file.name,
            relativePath: file.webkitRelativePath || file.name,
            dataBase64: await fileToBase64(file),
          })),
        )
        const response = await fetch('/api/pipeline/upload-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, files: payload }),
        })
        const data = await readApiJson<{ saved?: string[]; error?: string }>(response)
        if (!response.ok) throw new Error(data.error ?? response.statusText)
        uploaded += data.saved?.length ?? currentBatch.length
      }
      pushLocal(
        setLocalNotes,
        `${uploaded} ${kind === 'book' ? 'manuscript' : 'voice sample'}${uploaded === 1 ? '' : 's'} added${selectedFiles.length > files.length ? `; ${selectedFiles.length - files.length} unsupported file${selectedFiles.length - files.length === 1 ? '' : 's'} skipped` : ''}.`,
      )
      await refreshStatus()
    } catch (error) {
      pushLocal(
        setLocalNotes,
        `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      setLogOpen(true)
    } finally {
      setBusy(false)
      setActiveAction('')
      onPipelineBusy(false)
    }
  }

  const saveBooksPath = async () => {
    const nextPath = booksPathDraft.trim()
    if (!nextPath || disabled || nextPath === status?.booksPath) return
    setBusy(true)
    setActiveAction('Switching manuscript folder')
    onPipelineBusy(true)
    try {
      const response = await fetch('/api/settings/books-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booksPath: nextPath }),
      })
      const data = await readApiJson<{
        status?: PipelineStatus
        error?: string
      }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      if (data.status) setStatus(data.status)
      else await refreshStatus()
      pushLocal(
        setLocalNotes,
        'Manuscript folder changed. Draftloom will prepare this library before the next draft.',
      )
    } catch (error) {
      pushLocal(
        setLocalNotes,
        `Could not change the manuscript folder: ${error instanceof Error ? error.message : String(error)}`,
      )
      setLogOpen(true)
    } finally {
      setBusy(false)
      setActiveAction('')
      onPipelineBusy(false)
    }
  }

  const loadLatest = async () => {
    if (auditBusy || busy || keySaving) return
    setBusy(true)
    setActiveAction('Opening your latest draft')
    onPipelineBusy(true)
    try {
      const response = await fetch('/api/pipeline/latest-draft')
      const data = await readApiJson<{ path?: string; content?: string; error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? response.statusText)
      if (typeof data.content === 'string') {
        onLoadPost(data.content, { diskPath: data.path ?? null })
        pushLocal(setLocalNotes, 'Latest saved draft opened.')
      }
    } catch (error) {
      pushLocal(
        setLocalNotes,
        `Could not open the draft: ${error instanceof Error ? error.message : String(error)}`,
      )
      setLogOpen(true)
    } finally {
      setBusy(false)
      setActiveAction('')
      onPipelineBusy(false)
    }
  }

  const disabled = auditBusy || busy || keySaving
  const promptTrim = topicPrompt.trim()
  const promptOk = promptTrim.length >= MIN_TOPIC_PROMPT_LEN
  const hasBooks = (status?.bookFileCount ?? 0) > 0
  const libraryReady = Boolean(
    status &&
      status.chunkCount > 0 &&
      status.embeddedCount >= status.chunkCount &&
      !status.sourcesNeedScan &&
      !status.embeddingsNeedRefresh,
  )
  const canCreate = Boolean(status?.apiKeyConfigured && hasBooks && promptOk && !disabled)

  const createDraft = () => {
    if (!canCreate) return
    void run(
      libraryReady ? 'Creating your draft' : 'Preparing your library and creating your draft',
      libraryReady ? '/api/pipeline/draft' : '/api/pipeline/full',
      { customTopicPrompt: promptTrim },
    )
  }

  const onFiles = (kind: 'book' | 'voice') => (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files
    event.currentTarget.value = ''
    void uploadFiles(kind, files)
  }

  const logText =
    serverLines.length > 0
      ? serverLines.join('\n')
      : 'Activity will appear here while Draftloom prepares your library and writes.'
  const localBlock = localNotes.length > 0 ? `\n\n— recent activity —\n${localNotes.join('\n')}` : ''

  return (
    <section className="composer-card" id="create">
      <div className="composer-heading">
        <div>
          <span className="eyebrow">Create a new post</span>
          <h1>What idea should we pull from your books?</h1>
          <p>Give Draftloom a direction. It finds the right passages and turns them into a polished long-form draft.</p>
        </div>
        <div className={`connection-chip ${apiOnline === false ? 'is-offline' : ''}`}>
          <span className="connection-dot" aria-hidden="true" />
          {apiOnline === false ? 'App service offline' : 'Private on this computer'}
        </div>
      </div>

      {apiOnline === false && (
        <div className="setup-alert" role="alert">
          <strong>Draftloom’s local service is not running.</strong>
          <span>Close this window, start the app again, then refresh this page.</span>
        </div>
      )}

      {apiOnline !== false && status && (
        <div className="readiness-row" aria-label="Setup progress">
          <div className={`readiness-step ${status.apiKeyConfigured ? 'is-complete' : 'is-current'}`}>
            <span>{status.apiKeyConfigured ? '✓' : '1'}</span>
            <div><strong>AI connected</strong><small>{status.apiKeyConfigured ? status.chatModel : 'One-time setup'}</small></div>
          </div>
          <div className={`readiness-line ${status.apiKeyConfigured ? 'is-complete' : ''}`} />
          <div className={`readiness-step ${hasBooks ? 'is-complete' : status.apiKeyConfigured ? 'is-current' : ''}`}>
            <span>{hasBooks ? '✓' : '2'}</span>
            <div><strong>Books added</strong><small>{hasBooks ? `${status.bookFileCount} manuscript${status.bookFileCount === 1 ? '' : 's'}` : 'Add .docx files'}</small></div>
          </div>
          <div className={`readiness-line ${hasBooks ? 'is-complete' : ''}`} />
          <div className={`readiness-step ${libraryReady ? 'is-complete' : hasBooks ? 'is-current' : ''}`}>
            <span>{libraryReady ? '✓' : '3'}</span>
            <div><strong>Ready to write</strong><small>{libraryReady ? `${status.chunkCount.toLocaleString()} passages prepared` : 'Prepared automatically'}</small></div>
          </div>
        </div>
      )}

      {status && (!status.apiKeyConfigured || !hasBooks) && (
        <div className="quick-setup">
          {!status.apiKeyConfigured && (
            <div className="setup-card setup-card-key">
              <div className="setup-card-icon" aria-hidden="true">⌁</div>
              <div className="setup-card-copy">
                <span className="setup-kicker">One-time connection</span>
                <h2>Connect your OpenAI key</h2>
                <p>Your key is saved only in this app’s folder on your computer.</p>
                <div className="key-entry">
                  <input
                    type="password"
                    value={apiKey}
                    disabled={disabled}
                    onChange={(event) => setApiKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveApiKey()
                    }}
                    placeholder="sk-…"
                    aria-label="OpenAI API key"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="btn-dark" type="button" disabled={disabled || !apiKey.trim()} onClick={() => void saveApiKey()}>
                    {keySaving ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Where do I get a key? ↗</a>
              </div>
            </div>
          )}

          {!hasBooks && (
            <label className="setup-card setup-card-upload">
              <input type="file" accept=".docx" multiple disabled={disabled} onChange={onFiles('book')} />
              <div className="setup-card-icon file-icon" aria-hidden="true">W</div>
              <div className="setup-card-copy">
                <span className="setup-kicker">Your source material</span>
                <h2>Add your manuscripts</h2>
                <p>Choose individual Word documents, or import a whole folder below. They stay on your computer.</p>
                <span className="inline-link">Choose .docx files <span>→</span></span>
              </div>
            </label>
          )}
        </div>
      )}

      {status && hasBooks && (
        <div className="library-strip-wrap">
          <div className="library-strip">
            <div className="library-summary">
              <span className="library-icon file-icon" aria-hidden="true">W</span>
              <div>
                <strong>{status.bookFileCount} manuscript{status.bookFileCount === 1 ? '' : 's'} in your library</strong>
                <small>{status.voiceFileCount > 0 ? `${status.voiceFileCount} voice sample${status.voiceFileCount === 1 ? '' : 's'} added` : 'Voice matching is optional'}</small>
              </div>
            </div>
            <div className="library-actions">
              <label className="text-button">
                Add books
                <input type="file" accept=".docx" multiple disabled={disabled} onChange={onFiles('book')} />
              </label>
              <label className="text-button">
                Import a folder
                <input
                  type="file"
                  accept=".docx"
                  multiple
                  disabled={disabled}
                  onChange={onFiles('book')}
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                />
              </label>
              <label className="text-button">
                Add voice samples
                <input type="file" accept=".docx,.txt" multiple disabled={disabled} onChange={onFiles('voice')} />
              </label>
            </div>
          </div>
          {status.bookGroups.length > 0 && (
            <div className="library-collections" aria-label="Library collections">
              <span>Collections</span>
              <div>
                {status.bookGroups.map((group) => (
                  <span className="collection-chip" key={group.name}>{group.name} <strong>{group.count}</strong></span>
                ))}
              </div>
              <small>Use subfolders inside your manuscript folder to organize series, worlds, or projects.</small>
            </div>
          )}
        </div>
      )}

      <div className="prompt-workspace">
        <div className="prompt-label-row">
          <label htmlFor="pipeline-topic-prompt">Your creative brief</label>
          <span>{topicPrompt.length} characters</span>
        </div>
        <textarea
          id="pipeline-topic-prompt"
          className="prompt-input"
          rows={5}
          disabled={disabled || apiOnline === false}
          value={topicPrompt}
          onChange={(event) => setTopicPrompt(event.target.value)}
          placeholder="Example: Explore how grief changes the way Mara remembers her childhood. Keep it warm and personal, use the river scene, and avoid major spoilers."
        />
        <div className="prompt-starters" aria-label="Creative brief starters">
          <span>Try a starting point</span>
          {PROMPT_STARTERS.map((starter) => (
            <button key={starter} type="button" disabled={disabled} onClick={() => setTopicPrompt(starter)}>
              {starter}
            </button>
          ))}
        </div>
        <div className="create-actions">
          <button className="btn-primary btn-create" type="button" disabled={!canCreate} onClick={createDraft}>
            {busy ? <span className="button-spinner" aria-hidden="true" /> : <span aria-hidden="true">✦</span>}
            {busy ? activeAction : libraryReady ? 'Create draft' : 'Prepare library & create draft'}
          </button>
          {status?.latestDraftPath && (
            <button className="btn-soft" type="button" disabled={disabled} onClick={() => void loadLatest()}>
              Open latest draft
            </button>
          )}
          {!status?.apiKeyConfigured && <span className="action-hint">Connect OpenAI to continue</span>}
          {status?.apiKeyConfigured && !hasBooks && <span className="action-hint">Add at least one manuscript to continue</span>}
          {status?.apiKeyConfigured && hasBooks && !promptOk && <span className="action-hint">Add a little more detail to your brief</span>}
        </div>
        <p className="privacy-note"><span aria-hidden="true">●</span> Manuscripts and drafts remain in your local app folder. Only relevant text is sent to OpenAI when you create or review a draft.</p>
      </div>

      <details className="advanced-tools">
        <summary>Library tools & activity</summary>
        <div className="advanced-tools-body">
          <div className="library-location-editor">
            <div>
              <strong>Manuscript folder</strong>
              <p>Point Draftloom at any existing folder on this computer. Nested folders become collections automatically.</p>
            </div>
            <div className="folder-path-entry">
              <input
                type="text"
                value={booksPathDraft}
                disabled={disabled}
                onChange={(event) => setBooksPathDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveBooksPath()
                }}
                placeholder="C:\\My Books\\Manuscripts"
                aria-label="Manuscript folder path"
                spellCheck={false}
              />
              <button type="button" disabled={disabled || !booksPathDraft.trim() || booksPathDraft.trim() === status?.booksPath} onClick={() => void saveBooksPath()}>Use this folder</button>
            </div>
          </div>
          <div className="advanced-button-row">
            <button type="button" disabled={disabled} onClick={() => run('Refreshing manuscripts', '/api/pipeline/ingest-books')}>Rescan books</button>
            <button type="button" disabled={disabled} onClick={() => run('Refreshing voice samples', '/api/pipeline/ingest-voice')}>Rescan voice</button>
            <button type="button" disabled={disabled} onClick={() => run('Preparing source passages', '/api/pipeline/embed')}>Prepare passages</button>
            <button type="button" disabled={disabled} onClick={() => void refreshStatus()}>Refresh status</button>
          </div>
          <details className="activity-log" open={logOpen} onToggle={(event) => setLogOpen(event.currentTarget.open)}>
            <summary>{busy ? 'Working now — view activity' : 'View recent activity'}</summary>
            <pre ref={logEndRef} aria-live="polite">{logText}{localBlock}</pre>
          </details>
        </div>
      </details>
    </section>
  )
}
