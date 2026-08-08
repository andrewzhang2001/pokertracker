import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { fetchNote, saveNote } from '../lib/notesApi'

// A persistent study-note pad, anchored to a semantic page key (see
// noteAnchor.ts). Drop it into any page header: <NotesPanel anchor={...} />.
// The note loads on mount (so the "has a note" dot shows even while collapsed),
// autosaves on blur, and flushes a pending edit if you navigate to another
// anchor before blurring. Notes are per-account and filter-blind by design.

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error'

// widthClass / rows / minHeightClass let a heavy-use page (e.g. postflop) open a
// bigger pad while other pages keep the compact default.
export default function NotesPanel({
  anchor,
  widthClass = 'w-96',
  rows = 10,
  minHeightClass = 'min-h-[8rem]',
}: {
  anchor: string
  widthClass?: string
  rows?: number
  minHeightClass?: string
}) {
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [open, setOpen] = useState(false)
  // The panel is rendered in a portal with FIXED coords anchored to the toggle
  // button, so an ancestor's `overflow-hidden` (every view's h-screen container)
  // can't clip it — which was cutting off the textarea and making it awkward to
  // scroll. Coords are recomputed on open and while scrolling/resizing.
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  // Latest body/saved for the anchor-change flush (see the effect below), which
  // needs the values as of the moment the anchor changed, not the effect closure.
  const stateRef = useRef({ body, saved })
  stateRef.current = { body, saved }

  const doSave = useCallback(async (a: string, text: string) => {
    setStatus('saving')
    try {
      const n = await saveNote(a, text)
      // Ignore a stale save that resolves after we've moved to another anchor.
      if (a === anchorRef.current) { setSaved(n.body); setStatus('saved') }
    } catch {
      if (a === anchorRef.current) setStatus('error')
    }
  }, [])

  // Track the live anchor so a resolving save knows if it's still current.
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

  // Load on anchor change; on the way out, flush a dirty edit for the OLD anchor
  // (the effect closure's `anchor`) using the body captured in stateRef.
  useEffect(() => {
    let live = true
    setStatus('loading')
    fetchNote(anchor)
      .then(n => { if (live) { setBody(n.body); setSaved(n.body); setStatus('idle') } })
      .catch(() => { if (live) setStatus('error') })
    return () => {
      live = false
      clearTimeout(timer.current)
      const { body: b, saved: s } = stateRef.current
      if (b.trim() !== s.trim()) doSave(anchor, b)
    }
  }, [anchor, doSave])

  const flush = () => {
    clearTimeout(timer.current)
    if (body.trim() !== saved.trim()) doSave(anchor, body)
  }

  const onChange = (v: string) => {
    setBody(v)
    setStatus('idle')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(anchor, v), 1000)
  }

  const hasNote = saved.trim() !== ''
  const statusText =
    status === 'saving' ? 'saving…' : status === 'saved' ? 'saved'
    : status === 'error' ? 'save failed' : status === 'loading' ? 'loading…' : ''

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }, [])

  // While open: keep the panel pinned under the button, and close on an outside
  // click (flushing first via the textarea's blur, which fires before this).
  useEffect(() => {
    if (!open) return
    place()
    const onScroll = () => place()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        title={hasNote ? 'Notes (has notes)' : 'Notes'}
        className={`flex items-center gap-1.5 text-xs border rounded px-2 py-1 transition-colors ${
          open ? 'border-yellow-500/50 text-yellow-300' : 'border-gray-700 text-gray-400 hover:text-white'
        }`}
      >
        <span>📝 Notes</span>
        {hasNote && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
      </button>

      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, right: coords.right, maxHeight: `calc(100vh - ${coords.top + 12}px)` }}
          className={`${widthClass} z-50 flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2`}
        >
          <div className="flex items-center justify-between mb-1 px-0.5 shrink-0">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">notes for this spot</span>
            <span className="text-[10px] text-gray-500">{statusText}</span>
          </div>
          <textarea
            value={body}
            onChange={e => onChange(e.target.value)}
            onBlur={flush}
            autoFocus
            rows={rows}
            placeholder="High-level reads for this spot — applies across every filter…"
            className={`flex-1 ${minHeightClass} resize-none overflow-y-auto bg-black/40 border border-gray-800 rounded p-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-yellow-500/40`}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
