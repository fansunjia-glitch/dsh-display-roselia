import { band, logo, members } from './artwork'
import { DEFAULTS, STORAGE_KEY, readPreferences, type Preferences, type Scene } from './preferences'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Install an accessible native dialog and a small, reversible theme launcher. */
export function installControls(onChange: (value: Preferences) => void): () => void {
  let preferences: Preferences
  try { preferences = readPreferences(window.localStorage) } catch { preferences = { ...DEFAULTS } }
  const abort = new AbortController()
  const events = { signal: abort.signal }
  const launcher = element('button', 'roselia-launcher')
  launcher.type = 'button'
  launcher.setAttribute('aria-label', '打开 Roselia 主题设置')
  launcher.setAttribute('aria-haspopup', 'dialog')
  launcher.title = 'Roselia · 主题设置'
  launcher.append(element('span', 'roselia-launcher-monogram', 'R'), element('span', 'roselia-launcher-label', 'ROSELIA'))
  const dialog = element('dialog', 'roselia-dialog')
  dialog.setAttribute('aria-labelledby', 'roselia-dialog-title')
  const cover = element('div', 'roselia-dialog-cover')
  cover.style.backgroundImage = `url("${band}")`
  const coverLogo = element('img', 'roselia-dialog-logo')
  coverLogo.src = logo
  coverLogo.alt = 'Roselia'
  const close = element('button', 'roselia-close', '×')
  close.type = 'button'
  close.setAttribute('aria-label', '关闭主题设置')
  cover.append(coverLogo, close)
  const body = element('div', 'roselia-dialog-body')
  body.append(element('p', 'roselia-eyebrow', 'BANG DREAM!  /  PERSONAL THEME'))
  const title = element('h2', 'roselia-dialog-title', 'Nocturne · 夜曲')
  title.id = 'roselia-dialog-title'
  body.append(title, element('p', 'roselia-description', '五人的舞台，每一次相遇都是新的序曲。'))

  const sceneGroup = element('fieldset', 'roselia-fieldset')
  sceneGroup.append(element('legend', 'roselia-label', '背景场景'))
  const sceneGrid = element('div', 'roselia-scene-grid')
  const scenes: { id: Scene; name: string; caption: string }[] = [
    { id: 'stage', name: '成员舞台', caption: 'Roselia · 此刻的主角' },
    { id: 'nocturne', name: '夜曲', caption: '月光 · 蓝玫瑰' },
    { id: 'live', name: '演出', caption: '五人的舞台' },
    { id: 'quiet', name: '纯净', caption: '只保留主题配色' },
  ]
  const sceneButtons = scenes.map(scene => {
    const button = element('button', `roselia-scene roselia-scene-${scene.id}`)
    button.type = 'button'
    button.dataset.scene = scene.id
    button.append(element('span', 'roselia-scene-art'), element('strong', '', scene.name), element('span', '', scene.caption))
    button.addEventListener('click', () => update({ scene: scene.id }), events)
    sceneGrid.append(button)
    return button
  })
  sceneGroup.append(sceneGrid)
  body.append(sceneGroup)

  const memberGroup = element('fieldset', 'roselia-fieldset')
  memberGroup.append(element('legend', 'roselia-label', '舞台主角'))
  const memberGrid = element('div', 'roselia-member-grid')
  const random = element('button', 'roselia-member roselia-member-random')
  random.type = 'button'
  random.dataset.member = 'random'
  random.setAttribute('aria-label', '随机成员')
  const shuffle = element('span', 'roselia-portrait roselia-shuffle', '↝')
  shuffle.setAttribute('aria-hidden', 'true')
  random.append(shuffle, element('span', '', '随机相遇'))
  random.addEventListener('click', () => update({ member: 'random', artwork: true }), events)
  memberGrid.append(random)
  const memberButtons = [random, ...members.map(member => {
    const button = element('button', 'roselia-member')
    button.type = 'button'
    button.dataset.member = member.id
    button.setAttribute('aria-label', member.name)
    const portrait = element('span', 'roselia-portrait')
    const image = element('img', '')
    image.src = member.image
    image.alt = ''
    image.draggable = false
    portrait.append(image)
    button.append(portrait, element('span', '', member.name))
    button.addEventListener('click', () => update({ member: member.id, artwork: true }), events)
    memberGrid.append(button)
    return button
  })]
  memberGroup.append(memberGrid)
  memberGroup.append(element('p', 'roselia-member-hint', '随机相遇：每次进入首页换一位成员，不连续重复。'))
  body.append(memberGroup)

  const rangeLabel = element('label', 'roselia-range-label', '氛围强度')
  const output = element('output', '')
  rangeLabel.append(output)
  const range = element('input', 'roselia-range')
  range.type = 'range'
  range.min = '0'
  range.max = '100'
  range.step = '5'
  range.setAttribute('aria-label', '氛围强度')
  rangeLabel.append(range)
  range.addEventListener('input', () => update({ intensity: Number(range.value) }), events)
  body.append(rangeLabel)

  const toggleLabel = element('label', 'roselia-toggle')
  const check = element('input', '')
  check.type = 'checkbox'
  check.addEventListener('change', () => update({ artwork: check.checked }), events)
  toggleLabel.append(element('span', '', '显示成员装饰'), check)
  body.append(toggleLabel, element('p', 'roselia-hint', '明暗模式与字体跟随 DSH；对话中自动降低背景强度。'))

  const footer = element('div', 'roselia-dialog-footer')
  const reset = element('button', 'roselia-reset', '恢复默认')
  reset.type = 'button'
  reset.addEventListener('click', () => update({ ...DEFAULTS }), events)
  const source = element('a', 'roselia-source', 'Roselia 官方 ↗')
  source.href = 'https://bang-dream.bushimo.jp/character/roselia/'
  source.target = '_blank'
  source.rel = 'noopener noreferrer'
  footer.append(reset, source)
  const status = element('p', 'roselia-status')
  status.setAttribute('role', 'status')
  body.append(footer, status)
  dialog.append(cover, body)
  document.body.append(launcher, dialog)

  function render(): void {
    for (const button of sceneButtons) button.setAttribute('aria-pressed', String(button.dataset.scene === preferences.scene))
    for (const button of memberButtons) button.setAttribute('aria-pressed', String(button.dataset.member === preferences.member))
    range.value = String(preferences.intensity)
    output.value = `${preferences.intensity}%`
    check.checked = preferences.artwork
    memberGroup.disabled = preferences.scene === 'quiet'
    range.disabled = preferences.scene === 'quiet'
    check.disabled = preferences.scene === 'quiet'
    onChange(preferences)
  }
  function update(patch: Partial<Preferences>): void {
    preferences = { ...preferences, ...patch }
    render()
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...preferences }))
      status.textContent = ''
    } catch {
      status.textContent = '当前窗口已应用；浏览器不允许保存偏好。'
    }
  }
  launcher.addEventListener('click', () => { if (!dialog.open) dialog.showModal() }, events)
  close.addEventListener('click', () => dialog.close(), events)
  dialog.addEventListener('close', () => launcher.focus(), events)
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')]
      .filter(node => node.getClientRects().length > 0)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }, events)
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close()
  }, events)
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) {
      try { preferences = readPreferences(window.localStorage) } catch { preferences = { ...DEFAULTS } }
      render()
    }
  }, events)
  render()
  return () => {
    abort.abort()
    if (dialog.open) dialog.close()
    dialog.remove()
    launcher.remove()
  }
}
