import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ModelDirectoryState, ReasoningContext, ReasoningSlotProps } from './reasoning-contracts'
import css from './reasoning.css?inline'

interface EffortChoice { effort: string | undefined; label: string }

/** IDs and order belong to the adapter; there are no invented effort values. */
export function reasoningView(state: ModelDirectoryState) {
  const current = state.current
  if (current === null || state.routable === false) return null
  const model = state.groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model)
  const reasoning = model?.reasoning
  if (model === undefined || reasoning === undefined || reasoning.efforts.length === 0) return null
  const choices: EffortChoice[] = [
    ...(reasoning.defaultEffort === undefined ? [{ effort: undefined, label: '默认' }] : []),
    ...reasoning.efforts.map(level => ({ effort: level.id, label: level.name })),
  ]
  const effort = current.reasoningEffort ?? reasoning.defaultEffort
  const selectedIndex = choices.findIndex(choice => choice.effort === effort)
  if (selectedIndex < 0 || choices.length < 2) return null
  return {
    current, choices, selectedIndex,
    modelName: model.name,
    defaultIndex: choices.findIndex(choice => choice.effort === reasoning.defaultEffort),
    identity: JSON.stringify([current.provider, current.model, choices.map(choice => choice.effort)]),
  }
}

function Lightning() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m13.3 2.5-8 11h6l-.7 8 8-11h-6l.7-8Z" fill="currentColor" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>
}

function Reset() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.8 9a7.5 7.5 0 1 1-.3 5M4.8 9V3.8M4.8 9H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

const adjustmentKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'PageUp', 'PageDown'])

function ReasoningControl({ directory, load, select }: ReasoningSlotProps & { directory: NonNullable<ReasoningSlotProps['directory']> }) {
  const state = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot())
  const view = reasoningView(state)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ identity: string; index: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const gesture = useRef<{ identity: string } | null>(null)
  const attempt = useRef(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const range = useRef<HTMLInputElement>(null)
  const reset = useRef<HTMLButtonElement>(null)
  const popupId = useId()
  const descriptionId = useId()
  const statusId = useId()

  useEffect(() => {
    mounted.current = true
    void load().catch(() => { /* the shared directory exposes catalog failures */ })
    return () => { mounted.current = false; ++attempt.current; gesture.current = null }
  }, [load])

  const identity = view?.identity
  useEffect(() => {
    gesture.current = null
    setDraft(null)
    setFailure(null)
    setOpen(false)
  }, [identity])

  const close = (returnFocus: boolean) => {
    gesture.current = null
    setDraft(null)
    setOpen(false)
    if (returnFocus) trigger.current?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (!open) return
    const panel = popup.current
    const anchor = trigger.current
    if (panel === null || anchor === null) return
    // Native manual popover supplies a top layer without delegating dismissal
    // or focus ownership. The body portal is an older-WebView fallback as well.
    if (typeof panel.showPopover === 'function') {
      panel.setAttribute('popover', 'manual')
      try { panel.showPopover() } catch { panel.removeAttribute('popover') }
    }
    const position = () => {
      const rect = anchor.getBoundingClientRect()
      const bounds = panel.getBoundingClientRect()
      const width = window.innerWidth
      const height = window.innerHeight
      panel.style.left = `${Math.max(12, Math.min(rect.right - bounds.width, width - bounds.width - 12))}px`
      const above = rect.top - bounds.height - 12
      panel.style.top = `${above >= 12 ? above : Math.max(12, Math.min(rect.bottom + 12, height - bounds.height - 12))}px`
    }
    position()
    range.current?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !panel.contains(target) && !anchor.contains(target)) close(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    resize?.observe(panel)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      resize?.disconnect()
      if (typeof panel.hidePopover === 'function' && panel.hasAttribute('popover')) {
        try { panel.hidePopover() } catch { /* already removed with the slot */ }
      }
    }
  }, [open])

  const busy = saving || state.status === 'selecting' || state.status === 'loading'
  const commit = async (index: number, expectedIdentity: string): Promise<void> => {
    const fresh = directory.getSnapshot()
    const freshView = reasoningView(fresh)
    setDraft(null)
    if (inFlight.current || fresh.status === 'selecting' || fresh.status === 'loading'
      || freshView === null || freshView.identity !== expectedIdentity) return
    const choice = freshView.choices[index]
    if (choice === undefined || index === freshView.selectedIndex) return
    inFlight.current = true
    const id = ++attempt.current
    setSaving(true)
    setFailure(null)
    try {
      const result = await select({
        provider: freshView.current.provider,
        model: freshView.current.model,
        ...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort }),
      })
      if (!mounted.current || attempt.current !== id) return
      if (result === undefined) setFailure('此会话暂时无法切换推理强度。')
      else if (!result.ok) setFailure(result.error.code === 'session/writer-held'
        ? '此会话正由另一窗口使用，请稍后重试。'
        : `未能切换推理强度：${result.error.message}`)
    } catch (error) {
      if (mounted.current && attempt.current === id) setFailure(`未能切换推理强度：${error instanceof Error ? error.message : '连接暂时不可用，请重试。'}`)
    } finally {
      inFlight.current = false
      if (mounted.current && attempt.current === id) setSaving(false)
    }
  }

  if (view === null) return null
  const pendingIndex = state.pending?.provider === view.current.provider && state.pending.model === view.current.model
    ? view.choices.findIndex(choice => choice.effort === state.pending!.reasoningEffort)
    : -1
  const selectedIndex = draft?.identity === view.identity ? draft.index : pendingIndex >= 0 ? pendingIndex : view.selectedIndex
  const selected = view.choices[selectedIndex]!
  const progress = selectedIndex / (view.choices.length - 1)
  const error = failure ?? (state.status === 'error' ? state.error : null)
  const cancelGesture = () => { gesture.current = null; setDraft(null) }
  const resetUnavailable = busy || view.defaultIndex < 0 || view.defaultIndex === view.selectedIndex
  return <>
    <button
      type="button" ref={trigger} className="roselia-effort-trigger"
      aria-label={`选择推理强度，当前 ${view.choices[view.selectedIndex]!.label}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={popupId}
      title={`推理强度 · ${view.choices[view.selectedIndex]!.label}`}
      onClick={() => { if (open) close(true); else setOpen(true) }}
    >
      <Lightning /><span className="roselia-effort-trigger-label">推理强度</span><span className="roselia-effort-trigger-value">{view.choices[view.selectedIndex]!.label}</span>
    </button>
    {open && createPortal(<div
      ref={popup} id={popupId} className="roselia-effort-popover" data-roselia-reasoning=""
      role="dialog" aria-label="选择推理强度" aria-busy={busy}
      style={{ '--effort-progress': progress, '--effort-hue': 214 + progress * 75 } as CSSProperties}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        event.preventDefault()
        if (document.activeElement === range.current) reset.current?.focus()
        else range.current?.focus()
      }}
    >
      <div className="roselia-effort-heading">
        <span className="roselia-effort-emblem"><Lightning /></span>
        <div className="roselia-effort-caption">
          <div className="roselia-effort-value" aria-hidden="true">{selected.label}</div>
          <div className="roselia-effort-model" title={view.modelName}>{view.modelName}</div>
        </div>
        <button ref={reset} className="roselia-effort-reset" type="button" aria-label="恢复模型默认推理强度" title="恢复模型默认推理强度" aria-disabled={resetUnavailable} onClick={() => { if (!resetUnavailable) void commit(view.defaultIndex, view.identity) }}><Reset /></button>
      </div>
      <div className="roselia-effort-scale" data-disabled={busy ? '' : undefined}>
        <div className="roselia-effort-track" aria-hidden="true">
          <span className="roselia-effort-fill"><span className="roselia-effort-particles">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--particle-index': index, top: `${18 + index % 4 * 18}%` } as CSSProperties} />)}</span></span>
          <span className="roselia-effort-thumb" />
        </div>
        <input
          ref={range} className="roselia-effort-range" type="range" min={0} max={view.choices.length - 1} step={1}
          value={selectedIndex} aria-disabled={busy} aria-label="推理强度" aria-valuetext={selected.label}
          aria-describedby={`${descriptionId}${error === null ? '' : ` ${statusId}`}`}
          onPointerDown={event => {
            if (busy) { event.preventDefault(); return }
            gesture.current = { identity: view.identity }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onChange={event => {
            if (busy) { event.currentTarget.value = String(selectedIndex); return }
            const index = Number(event.currentTarget.value)
            setDraft({ identity: view.identity, index })
            if (gesture.current === null) void commit(index, view.identity)
          }}
          onPointerUp={event => {
            const started = gesture.current
            gesture.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            if (started !== null) void commit(Number(event.currentTarget.value), started.identity)
          }}
          onPointerCancel={cancelGesture} onBlur={cancelGesture}
          onKeyDown={event => { if (busy && adjustmentKeys.has(event.key)) event.preventDefault() }}
        />
      </div>
      <span className="roselia-effort-hint" id={descriptionId}>拖动或用方向键选择推理强度，下次请求生效。Escape 关闭。</span>
      {busy && <span className="roselia-effort-hint" role="status">正在切换推理强度</span>}
      {error !== null && <p className="roselia-effort-error" id={statusId} role="status">{error}</p>}
    </div>, document.body)}
  </>
}

function ReasoningSlider(props: ReasoningSlotProps) {
  return !props.available || props.directory === null ? null : <ReasoningControl key={props.sessionId} {...props} directory={props.directory} />
}

/** Official compact composer contribution; DSH's model menu remains intact. */
export function registerReasoningSlider(ctx: ReasoningContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-display-roselia/reasoning.css'
    style.textContent = css
    document.head.append(style)
    return () => { style.remove() }
  }, 'Roselia reasoning slider styles')
  // directoryFor lazily creates a session directory and reads ctx.remote.session
  // under Cordis's caller-context tracker. Declare its public dependencies even
  // when DSH's own picker has not initialized that directory yet.
  ctx.inject(['modelDirectories', 'sessions', 'remote', 'remote.session'], scope => {
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id: 'roselia-reasoning', order: 30,
      inject: sessionId => {
        if (scope.sessions.subagentAddress(sessionId) !== undefined) return {
          available: false, directory: null, load: () => Promise.resolve(), select: () => Promise.resolve(undefined),
        }
        const directory = scope.modelDirectories.directoryFor(sessionId)
        return { available: true, directory: directory.store, load: () => directory.load(), select: selection => directory.select(selection) }
      },
    }, ReasoningSlider))
  })
}
