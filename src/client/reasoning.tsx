import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ModelDirectoryState, ModelSelection, ReasoningContext, ReasoningSlotProps } from './reasoning-contracts'
import css from './reasoning.css?inline'

interface EffortChoice { effort: string | undefined; label: string }

function currentModel(state: ModelDirectoryState) {
  if (state.current === null || state.routable === false) return undefined
  const group = state.groups.find(group => group.id === state.current!.provider)
  const model = group?.models.find(model => model.id === state.current!.model)
  return group === undefined || model === undefined ? undefined : { group, model }
}

/** Adapter-owned IDs and order are the only selectable reasoning values. */
export function reasoningView(state: ModelDirectoryState) {
  const current = state.current
  const model = currentModel(state)?.model
  const reasoning = model?.reasoning
  if (current === null || model === undefined || reasoning === undefined || reasoning.efforts.length === 0) return null
  const choices: EffortChoice[] = [
    ...(reasoning.defaultEffort === undefined ? [{ effort: undefined, label: '默认' }] : []),
    ...reasoning.efforts.map(level => ({ effort: level.id, label: level.name })),
  ]
  const effort = current.reasoningEffort ?? reasoning.defaultEffort
  const selectedIndex = choices.findIndex(choice => choice.effort === effort)
  if (selectedIndex < 0 || choices.length < 2) return null
  return {
    current, choices, selectedIndex, modelName: model.name,
    defaultIndex: choices.findIndex(choice => choice.effort === reasoning.defaultEffort),
    identity: JSON.stringify([current.provider, current.model, choices.map(choice => choice.effort)]),
  }
}

function Reset() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.8 9a7.5 7.5 0 1 1-.3 5M4.8 9V3.8M4.8 9H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function Chevron() {
  return <svg className="roselia-effort-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
const adjustmentKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'PageUp', 'PageDown'])

function ReasoningControl({ directory, load, select, locked = false }: ReasoningSlotProps & { directory: NonNullable<ReasoningSlotProps['directory']> }) {
  const state = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot())
  const chosenModel = currentModel(state)
  const view = reasoningView(state)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<'effort' | 'models'>('effort')
  const [draft, setDraft] = useState<{ identity: string; index: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const mounted = useRef(false)
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  const inFlight = useRef(false)
  const loading = useRef(false)
  const gesture = useRef<{ identity: string } | null>(null)
  const attempt = useRef(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const range = useRef<HTMLInputElement>(null)
  const modelSwitch = useRef<HTMLButtonElement>(null)
  const modelList = useRef<HTMLDivElement>(null)
  const focusedControl = useRef<HTMLElement | null>(null)
  const popupId = useId()
  const descriptionId = useId()
  const statusId = useId()

  useEffect(() => {
    mounted.current = true
    void load().catch(error => {
      if (mounted.current) setFailure(`模型目录加载失败：${error instanceof Error ? error.message : '请重试。'}`)
    })
    return () => { mounted.current = false; ++attempt.current; gesture.current = null }
  }, [load])

  const identity = view?.identity
  const route = JSON.stringify([state.current?.provider, state.current?.model])
  useEffect(() => {
    gesture.current = null
    setDraft(null)
    setFailure(null)
    if (open && view === null) setPane('models')
  }, [identity, route])
  useEffect(() => {
    if (!locked) return
    gesture.current = null
    setDraft(null)
    setOpen(false)
  }, [locked])

  const close = (returnFocus: boolean) => {
    gesture.current = null
    focusedControl.current = null
    setDraft(null)
    setOpen(false)
    if (returnFocus) trigger.current?.focus({ preventScroll: true })
  }
  const showModels = () => { gesture.current = null; setDraft(null); setPane('models') }

  useLayoutEffect(() => {
    if (!open) return
    const panel = popup.current
    const anchor = trigger.current
    if (panel === null || anchor === null) return
    if (typeof panel.showPopover === 'function') {
      panel.setAttribute('popover', 'manual')
      try { panel.showPopover() } catch { panel.removeAttribute('popover') }
    }
    const position = () => {
      const rect = anchor.getBoundingClientRect()
      const bounds = panel.getBoundingClientRect()
      panel.style.left = `${Math.max(12, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - 12))}px`
      const above = rect.top - bounds.height - 12
      panel.style.top = `${above >= 12 ? above : Math.max(12, Math.min(rect.bottom + 12, window.innerHeight - bounds.height - 12))}px`
    }
    position()
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !panel.contains(target) && !anchor.contains(target)) close(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close(true)
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
        try { panel.hidePopover() } catch { /* removed with its public slot */ }
      }
    }
  }, [open])

  const initialControl = () => pane === 'models'
    ? modelList.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?? modelList.current?.querySelector<HTMLButtonElement>('[role="option"]')
      ?? popup.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
      ?? popup.current
    : range.current ?? modelSwitch.current

  useLayoutEffect(() => {
    if (!open) return
    initialControl()?.focus({ preventScroll: true })
  }, [open, pane])

  useLayoutEffect(() => {
    // A catalog refresh can remove the focused option without changing panes.
    // Recover only our removed control; never take focus from another surface.
    const previous = focusedControl.current
    const removed = previous !== null && !previous.isConnected && document.activeElement === document.body
    const catalogArrived = pane === 'models' && document.activeElement === popup.current && state.groups.length > 0
    if (!open || (!removed && !catalogArrived)) return
    initialControl()?.focus({ preventScroll: true })
  }, [open, pane, route, identity, state.groups])

  const busy = locked || saving || reloading || state.pending !== null || state.status === 'selecting' || state.status === 'loading'
  const reload = async () => {
    if (loading.current || inFlight.current || lockedRef.current || directory.getSnapshot().pending !== null) return
    loading.current = true; setReloading(true); setFailure(null)
    try { await load() }
    catch (error) { if (mounted.current) setFailure(`模型目录加载失败：${error instanceof Error ? error.message : '请重试。'}`) }
    finally { loading.current = false; if (mounted.current) setReloading(false) }
  }
  const submit = async (selection: ModelSelection, subject: '模型' | '推理强度'): Promise<boolean> => {
    const fresh = directory.getSnapshot()
    if (!mounted.current || inFlight.current || loading.current || lockedRef.current || fresh.pending !== null || fresh.status === 'selecting' || fresh.status === 'loading') return false
    inFlight.current = true
    const id = ++attempt.current
    setSaving(true); setFailure(null)
    try {
      const result = await select(selection)
      if (!mounted.current || attempt.current !== id) return false
      if (result === undefined) setFailure(`此会话暂时无法切换${subject}。`)
      else if (result.ok) return true
      else setFailure(result.error.code === 'session/writer-held'
        ? '此会话正由另一窗口使用，请稍后重试。'
        : `未能切换${subject}：${result.error.message}`)
    } catch (error) {
      if (mounted.current && attempt.current === id) setFailure(`未能切换${subject}：${error instanceof Error ? error.message : '连接暂时不可用，请重试。'}`)
    } finally {
      inFlight.current = false
      if (mounted.current && attempt.current === id) setSaving(false)
    }
    return false
  }
  const commit = async (index: number, expectedIdentity: string) => {
    const freshView = reasoningView(directory.getSnapshot())
    setDraft(null)
    if (freshView === null || freshView.identity !== expectedIdentity) return
    const choice = freshView.choices[index]
    if (choice === undefined || index === freshView.selectedIndex) return
    await submit({ provider: freshView.current.provider, model: freshView.current.model, ...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort }) }, '推理强度')
  }
  const chooseModel = async (provider: string, modelId: string) => {
    const fresh = directory.getSnapshot()
    if (busy || inFlight.current || lockedRef.current) return
    const model = fresh.groups.find(group => group.id === provider)?.models.find(model => model.id === modelId)
    if (model === undefined) { setFailure('模型目录已更新，请重新选择。'); return }
    const sameRoute = fresh.current?.provider === provider && fresh.current.model === modelId
    const currentEffort = sameRoute ? fresh.current?.reasoningEffort : undefined
    const currentValid = currentEffort === undefined || model.reasoning?.efforts.some(level => level.id === currentEffort)
    const defaultEffort = model.reasoning?.defaultEffort
    const effort = sameRoute && currentValid ? currentEffort
      : model.reasoning?.efforts.some(level => level.id === defaultEffort) ? defaultEffort : undefined
    const adjustable = model.reasoning !== undefined
      && model.reasoning.efforts.length + (model.reasoning.defaultEffort === undefined ? 1 : 0) >= 2
    if (sameRoute && currentValid) { setPane(adjustable ? 'effort' : 'models'); return }
    const ok = await submit({ provider, model: modelId, ...(effort === undefined ? {} : { reasoningEffort: effort }) }, '模型')
    if (ok && mounted.current) { setPane(adjustable ? 'effort' : 'models') }
  }

  const pendingIndex = view !== null && state.pending?.provider === view.current.provider && state.pending.model === view.current.model
    ? view.choices.findIndex(choice => choice.effort === state.pending!.reasoningEffort) : -1
  const selectedIndex = view === null ? 0 : draft?.identity === view.identity ? draft.index : pendingIndex >= 0 ? pendingIndex : view.selectedIndex
  const selected = view?.choices[selectedIndex]
  const progress = view === null ? 0 : selectedIndex / (view.choices.length - 1)
  const particleCount = 4 + Math.round(progress * 12)
  const modelName = chosenModel?.model.name ?? '选择模型'
  const reason = chosenModel?.model.reasoning
  const effective = state.current?.reasoningEffort ?? reason?.defaultEffort
  const effortLabel = reason === undefined ? undefined : effective === undefined ? '默认' : reason.efforts.find(level => level.id === effective)?.name
  const error = failure ?? (state.status === 'error' ? state.error : null)
  const cancelGesture = () => { gesture.current = null; setDraft(null) }
  const resetUnavailable = busy || view === null || view.defaultIndex < 0 || view.defaultIndex === view.selectedIndex
  const groups = state.groups.filter(group => group.models.length > 0)
  const options = () => [...modelList.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []]
  const moveOptionFocus = (key: string, current: HTMLElement) => {
    const rows = options()
    if (rows.length === 0) return
    const index = rows.indexOf(current as HTMLButtonElement)
    const next = key === 'Home' ? 0 : key === 'End' ? rows.length - 1 : key === 'ArrowUp' ? (index <= 0 ? rows.length - 1 : index - 1) : (index + 1) % rows.length
    rows[next]?.focus()
  }

  return <>
    <button
      type="button" ref={trigger} className="roselia-effort-trigger" disabled={locked}
      aria-label={chosenModel === undefined ? '选择模型' : `选择模型与推理强度，当前 ${modelName}${effortLabel === undefined ? '' : `，推理强度 ${effortLabel}`}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={popupId}
      title={`${modelName}${effortLabel === undefined ? '' : ` · ${effortLabel}`}`}
      onClick={() => { if (open) close(true); else { setPane(view === null ? 'models' : 'effort'); setOpen(true) } }}
    >
      <span className="roselia-effort-trigger-label">{modelName}</span>
      {effortLabel !== undefined && <span className="roselia-effort-trigger-value">{effortLabel}</span>}
      <Chevron />
    </button>
    {open && createPortal(<div
      ref={popup} id={popupId} className={`roselia-effort-popover${pane === 'models' ? ' roselia-model-picker' : ''}`} data-roselia-reasoning="" data-pane={pane}
      role="dialog" aria-label="选择模型与推理强度" aria-busy={busy} tabIndex={-1}
      style={{ '--effort-progress': progress, '--effort-hue': 214 + progress * 75 } as CSSProperties}
      onFocusCapture={event => { focusedControl.current = event.target as HTMLElement }}
      onBlurCapture={event => {
        const target = event.relatedTarget
        if (target !== null && (!(target instanceof Node) || !event.currentTarget.contains(target))) focusedControl.current = null
      }}
      onKeyDown={event => {
        if (event.key === 'Tab') {
          const controls = [...popup.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []]
          if (controls.length === 0) return
          event.preventDefault()
          const index = controls.indexOf(document.activeElement as HTMLElement)
          const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
          controls[next]?.focus()
        } else if (pane === 'models' && ((event.target as HTMLElement).getAttribute('role') === 'option' || event.target === event.currentTarget) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); moveOptionFocus(event.key, event.target as HTMLElement)
        }
      }}
    >
      {pane === 'effort' ? <>
        <div className="roselia-effort-heading">
          <div className="roselia-effort-caption">
            <div className="roselia-effort-value" aria-hidden="true">{selected?.label ?? effortLabel ?? '模型设置'}</div>
            <button ref={modelSwitch} type="button" className="roselia-effort-model roselia-model-switch" title="切换模型" aria-label={`切换模型，当前 ${modelName}`} onClick={showModels}><span>{modelName}</span><Chevron /></button>
          </div>
          {view === null ? <span className="roselia-effort-reset-placeholder" aria-hidden="true" /> : <button className="roselia-effort-reset" type="button" aria-label="恢复模型默认推理强度" title="恢复模型默认推理强度" aria-disabled={resetUnavailable} onClick={() => { if (!resetUnavailable) void commit(view.defaultIndex, view.identity) }}><Reset /></button>}
        </div>
        {view === null ? <p className="roselia-model-notice">{reason === undefined || reason.efforts.length < 2 ? '此模型未提供可调整的推理强度。' : '当前推理强度暂不可用，请重新选择模型。'}</p> : <div className="roselia-effort-scale" data-disabled={busy ? '' : undefined}>
          <div className="roselia-effort-track" aria-hidden="true">
            <span className="roselia-effort-fill"><span className="roselia-effort-particles">{Array.from({ length: particleCount }, (_, index) => <i key={index} style={{ '--particle-index': index, left: `${(index * 61.8) % 100}%`, top: `${18 + index % 4 * 18}%` } as CSSProperties} />)}</span></span>
            <span className="roselia-effort-thumb" />
          </div>
          <input
            ref={range} className="roselia-effort-range" type="range" min={0} max={view.choices.length - 1} step={1}
            value={selectedIndex} aria-disabled={busy} aria-label="推理强度" aria-valuetext={selected!.label}
            aria-describedby={`${descriptionId}${error === null ? '' : ` ${statusId}`}`}
            onPointerDown={event => {
              if (busy) { event.preventDefault(); return }
              gesture.current = { identity: view.identity }; event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onChange={event => {
              if (busy) { event.currentTarget.value = String(selectedIndex); return }
              const index = Number(event.currentTarget.value); setDraft({ identity: view.identity, index })
              if (gesture.current === null) void commit(index, view.identity)
            }}
            onPointerUp={event => {
              const started = gesture.current; gesture.current = null
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              if (started !== null) void commit(Number(event.currentTarget.value), started.identity)
            }}
            onPointerCancel={cancelGesture} onBlur={cancelGesture}
            onKeyDown={event => { if (busy && adjustmentKeys.has(event.key)) event.preventDefault() }}
          />
        </div>}
      </> : <>
        <div className="roselia-model-picker-header">
          <span>选择模型</span>
          {view !== null && <button type="button" className="roselia-model-back" aria-label="返回推理强度" onClick={() => setPane('effort')}>‹</button>}
        </div>
        <div ref={modelList} className="roselia-model-list" role="listbox" aria-label="可用模型">
          {groups.map(group => <div className="roselia-model-group" role="group" aria-label={group.name ?? group.id} key={group.id}>
            <div className="roselia-model-group-title" aria-hidden="true">{group.name ?? group.id}</div>
            {group.models.map(model => {
              const selected = state.current?.provider === group.id && state.current.model === model.id
              const pending = state.pending?.provider === group.id && state.pending.model === model.id
              return <button type="button" role="option" className="roselia-model-option" key={model.id} aria-selected={selected} aria-disabled={busy} onClick={() => { void chooseModel(group.id, model.id) }}>
                <span className="roselia-model-option-name">{model.name}</span><span className="roselia-model-option-check" aria-hidden="true">{pending ? '…' : selected ? '✓' : ''}</span>
              </button>
            })}
          </div>)}
          {groups.length === 0 && <p className="roselia-model-empty">{busy ? '正在加载模型…' : '暂无可用模型。'}</p>}
        </div>
        {(state.failures ?? []).map(item => <p className="roselia-model-notice" key={item.id}>{item.name}：{item.message}</p>)}
      </>}
      <span className="roselia-effort-hint" id={descriptionId}>拖动或用方向键选择推理强度，下次请求生效。点击模型名切换模型。Escape 关闭。</span>
      {busy && <span className="roselia-effort-hint" role="status">正在更新模型设置</span>}
      {error !== null && <p className="roselia-effort-error" id={statusId} role="status">{error}</p>}
      {(error !== null || (state.failures?.length ?? 0) > 0 || (!busy && state.groups.length === 0)) && <button type="button" className="roselia-model-retry" aria-label="重新加载模型" aria-disabled={busy} onClick={() => { if (!busy) void reload() }}>重新加载模型</button>}
    </div>, document.body)}
  </>
}

function ReasoningSlider(props: ReasoningSlotProps) {
  return !props.available || props.directory === null ? null : <ReasoningControl key={props.sessionId} {...props} directory={props.directory} />
}

/** Replace the public single model seat; disposal reveals the native occupant. */
export function registerReasoningSlider(ctx: ReasoningContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-display-roselia/reasoning.css'; style.textContent = css
    document.head.append(style)
    return () => { style.remove() }
  }, 'Roselia model and reasoning selector styles')
  // Lazy directory creation reads remote.session under Cordis's caller tracker.
  ctx.inject(['modelDirectories', 'sessions', 'remote', 'remote.session'], scope => {
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model', priority: -100,
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
