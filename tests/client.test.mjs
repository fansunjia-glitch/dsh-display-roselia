import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import React from 'react'
// React detects native input event support once at module initialization. Give
// that detection a browser DOM before importing it; each test still owns its
// separate document and restores the process globals on teardown.
const bootstrap = new JSDOM('<!doctype html><html><body></body></html>')
const bootstrapGlobals = new Map()
for (const key of ['window', 'document', 'navigator']) {
  bootstrapGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: bootstrap.window[key] ?? bootstrap.window })
}
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
for (const [key, descriptor] of bootstrapGlobals) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor)
  else delete globalThis[key]
}
bootstrap.window.close()

const require = createRequire(import.meta.url)
const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const wallpaperBytes = await readFile(new URL('../assets/roselia-nocturne.png', import.meta.url))
const PACKAGE = 'dsh-display-roselia'
const BRAND_SLOTS = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']
const REASONING_SLOT = 'conversation.input.model'
const SLOT_NAMES = [...BRAND_SLOTS, REASONING_SLOT]
const STORAGE_KEY = 'dsh-display-roselia.preferences.v1'
const DEFAULTS = { scene: 'stage', intensity: 75, artwork: true, member: 'random' }
const LEGACY_DEFAULTS = { scene: 'nocturne', intensity: 65, artwork: true, member: 'all' }

function makeDirectory(overrides = {}) {
  let snapshot = {
    current: null, routable: null, groups: [], failures: [], status: 'ready', pending: null, error: null,
    ...overrides,
  }
  const listeners = new Set()
  const selections = []
  let loads = 0
  let selectionHandler = async selection => {
    const routable = snapshot.groups.some(group => group.id === selection.provider && group.models.some(model => model.id === selection.model))
    publish({ current: selection, routable, status: 'ready', pending: null, error: null })
    return { ok: true, value: undefined }
  }
  function publish(patch) {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  return {
    selections, listeners, publish,
    setSelectionHandler(handler) { selectionHandler = handler },
    get loads() { return loads },
    controller: {
      store: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
      async load() { loads += 1; return snapshot },
      select(selection) { selections.push({ ...selection }); return selectionHandler(selection) },
    },
  }
}

/**
 * A deliberately small DSH boundary, with the behavior relevant to unload.
 * Contract references (read-only): ui-theme overrideTokens, and ui-renderer
 * SlotRegistry.register/inject. The bundle itself is evaluated unmodified.
 */
function makeContext({ declared = SLOT_NAMES, directory = makeDirectory(), subagent = false, missingServices = [], nativeModel = false } = {}) {
  const effects = new Set()
  const layers = new Map()
  const entries = new Map()
  if (nativeModel) {
    // The shipped single-slot occupant belongs to another plugin's lifetime.
    entries.set(REASONING_SLOT, [{
      options: { name: REASONING_SLOT, priority: 0 },
      component: () => React.createElement('button', { 'data-native-model-selector': '' }, 'Native model selector'),
    }])
  }
  const declarations = new Set(declared)
  const watchers = new Map()
  const baselineTokens = { '--dsw-alias-bg-base': 'original-base' }
  const injectionScopes = []
  const directoryRequests = []
  let mode = 'light'
  let parent = null
  let disposed = false

  function effect(setup) {
    if (disposed) throw new Error('Inactive plugin context')
    const record = { children: new Set(), release: null, live: true }
    const container = parent?.children ?? effects
    container.add(record)
    const previousParent = parent
    parent = record
    function dispose() {
      if (!record.live) return
      record.live = false
      for (const child of [...record.children].reverse()) child.dispose()
      record.release?.()
      container.delete(record)
    }
    record.dispose = dispose
    try {
      const result = setup()
      if (typeof result === 'function') record.release = result
      else if (result?.[Symbol.iterator]) {
        const releases = [...result]
        record.release = () => { for (const release of releases.reverse()) release() }
      }
    } catch (error) {
      dispose()
      throw error
    } finally {
      parent = previousParent
    }
    return dispose
  }

  const ctx = {
    effect,
    inject(services, setup) {
      const injected = new Set(services)
      injectionScopes.push([...services])
      // Optional Cordis scopes activate only when every declared service exists.
      if (services.some(service => missingServices.includes(service))) return
      const scope = Object.create(ctx)
      scope.modelDirectories = {
        directoryFor(sessionId) {
          assert.equal(sessionId, 'test-session')
          // Cordis carries the caller's injection scope into service methods.
          // On its first call ModelDirectoryResolver.directoryFor reads
          // sessions plus remote.session before caching the new directory.
          // A warmed native selector can hide a missing indirect dependency.
          for (const dependency of ['modelDirectories', 'sessions', 'remote', 'remote.session']) {
            assert.ok(injected.has(dependency), `cold model directory accessed ${dependency} without injection`)
          }
          directoryRequests.push({ sessionId, injected: [...injected] })
          return directory.controller
        },
      }
      return effect(() => setup(scope))
    },
    sessions: { subagentAddress() { return subagent ? { id: 'child' } : undefined } },
    theme: {
      overrideTokens(source, tokens) {
        for (const [key, value] of Object.entries(tokens)) {
          assert.equal(typeof value.light, 'string', `${key} needs a light value`)
          assert.equal(typeof value.dark, 'string', `${key} needs a dark value`)
          assert.ok(value.light.length && value.dark.length, `${key} cannot be empty`)
        }
        const layer = structuredClone(tokens)
        layers.set(source, layer)
        return () => { if (layers.get(source) === layer) layers.delete(source) }
      },
      getTheme() {
        return { preference: 'system', active: { id: mode, colorScheme: mode, tokens: resolvedTokens() } }
      },
    },
    slots: {
      register(options, component) {
        assert.ok(declarations.has(options.name), `undeclared slot ${options.name}`)
        return effect(() => {
          const list = entries.get(options.name) ?? []
          assert.ok(!list.some(entry => (entry.options.priority ?? 0) === (options.priority ?? 0)),
            `slot priority collision in ${options.name}`)
          const entry = { options, component }
          list.push(entry)
          list.sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))
          entries.set(options.name, list)
          return () => {
            const index = list.indexOf(entry)
            if (index >= 0) list.splice(index, 1)
            if (list.length === 0) entries.delete(options.name)
          }
        })
      },
      inject(name, callback) {
        return effect(() => {
          let active
          const reconcile = () => {
            active?.()
            active = declarations.has(name) ? effect(callback) : undefined
          }
          const set = watchers.get(name) ?? new Set()
          set.add(reconcile)
          watchers.set(name, set)
          reconcile()
          return () => {
            set.delete(reconcile)
            if (!set.size) watchers.delete(name)
            active?.()
          }
        })
      },
    },
  }

  function resolvedTokens() {
    const result = { ...baselineTokens }
    for (const layer of layers.values()) {
      for (const [key, values] of Object.entries(layer)) result[key] = values[mode]
    }
    return result
  }

  return {
    ctx, effects, layers, entries, watchers, resolvedTokens, directory, injectionScopes, directoryRequests,
    setMode(value) { mode = value },
    declare(name, present = true) {
      if (present) declarations.add(name)
      else declarations.delete(name)
      for (const callback of watchers.get(name) ?? []) callback()
    },
    dispose() {
      if (disposed) return
      for (const record of [...effects].reverse()) record.dispose()
      disposed = true
    },
  }
}

function fixture(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="host">Host content</main></body></html>', {
    url: 'https://dsh.test/', runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const { window } = dom
  const createdObjectURLs = []
  const revokedObjectURLs = []
  const activeObjectURLs = new Map()
  window.URL.createObjectURL = blob => {
    assert.ok(blob instanceof window.Blob, 'object URLs must wrap browser Blob objects')
    const url = `blob:${window.location.origin}/roselia-${createdObjectURLs.length + 1}`
    createdObjectURLs.push({ url, blob })
    activeObjectURLs.set(url, blob)
    return url
  }
  window.URL.revokeObjectURL = url => {
    revokedObjectURLs.push(url)
    activeObjectURLs.delete(url)
  }
  // jsdom does not implement native dialog opening/closing or UA keyboard
  // actions. Model only those methods; real Escape/Tab behavior needs a browser.
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true
    this.querySelector('button')?.focus()
  }
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new window.Event('close'))
  }
  const captures = new WeakMap()
  window.HTMLElement.prototype.setPointerCapture = function (id) { captures.set(this, id) }
  window.HTMLElement.prototype.hasPointerCapture = function (id) { return captures.get(this) === id }
  window.HTMLElement.prototype.releasePointerCapture = function () { captures.delete(this) }
  const savedGlobals = new Map()
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] ?? window })
  }
  const loaded = []
  const imported = []
  const mounted = []
  const mountedContainers = new Map()
  window.__ModuleLoader__ = { load: entry => loaded.push(entry) }
  const context = makeContext(options)
  const originalDOM = window.document.documentElement.outerHTML
  vm.runInContext(bundle, dom.getInternalVMContext(), { filename: 'lib/client.js' })
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, PACKAGE)
  assert.equal(window.document.documentElement.outerHTML, originalDOM, 'registration alone must not touch the DOM')
  const plugin = loaded[0].factory(id => {
    imported.push(id)
    assert.ok(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(id), `unexpected runtime dependency ${id}`)
    return require(id)
  })
  assert.equal(window.document.documentElement.outerHTML, originalDOM, 'factory initialization must not touch the DOM')

  t.after(() => {
    for (const root of mounted.reverse()) flushSync(() => root.unmount())
    context.dispose()
    assert.equal(activeObjectURLs.size, 0, 'plugin disposal must release all local image resources')
    window.close()
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })

  return {
    ...context, window, document: window.document, plugin, imported,
    createdObjectURLs, revokedObjectURLs, activeObjectURLs,
    activate() { plugin.apply(context.ctx) },
    renderSlot(name, props = {}, { container: owner } = {}) {
      const entry = context.entries.get(name)?.[0]
      assert.ok(entry, `missing slot ${name}`)
      const container = window.document.createElement('section')
      ;(owner ?? window.document.body).append(container)
      const root = createRoot(container)
      mounted.push(root)
      mountedContainers.set(container, root)
      flushSync(() => root.render(React.createElement(entry.component, { ...props, ...entry.options.inject?.('test-session') })))
      return container
    },
    unmountSlot(container) {
      const root = mountedContainers.get(container)
      assert.ok(root, 'the requested slot must be mounted')
      flushSync(() => root.unmount())
      mounted.splice(mounted.indexOf(root), 1)
      mountedContainers.delete(container)
      container.remove()
    },
    key(key, init = {}) {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    },
  }
}

test('the delivered client obeys the DSH factory and service-injection contract', t => {
  const f = fixture(t)
  assert.equal(typeof f.plugin.apply, 'function')
  assert.ok(f.plugin.inject.includes('theme'))
  assert.ok(f.plugin.inject.includes('slots'))
})

function select(f, selector) {
  const node = f.document.querySelector(selector)
  assert.ok(node, `missing ${selector}`)
  return node
}

function stored(f) {
  return JSON.parse(f.window.localStorage.getItem(STORAGE_KEY))
}

function assertDefaultState(f) {
  assert.equal(f.document.body.getAttribute('data-roselia-scene'), 'stage')
  assert.equal(f.document.body.getAttribute('data-roselia-artwork'), 'true')
  assert.equal(f.document.body.getAttribute('data-roselia-member-preference'), 'random')
  assert.equal(f.document.body.style.getPropertyValue('--roselia-strength'), '0.75')
  assert.equal(select(f, 'input[aria-label="氛围强度"]').value, '75')
}

test('activation and unload restore all owned tokens, DOM attributes, CSS variables and nodes', t => {
  const f = fixture(t)
  const body = f.document.body
  body.setAttribute('data-ds-dark-theme', '')
  body.setAttribute('data-roselia-display', 'before')
  body.setAttribute('data-roselia-scene', 'before-scene')
  body.style.setProperty('--roselia-strength', '0.2', 'important')
  body.style.setProperty('--roselia-member-image', 'url("before.webp")', 'important')
  body.style.setProperty('--unrelated', 'untouched')
  const previousImage = body.style.getPropertyValue('--roselia-member-image')
  const priorHead = f.document.head.innerHTML
  f.activate()
  assertDefaultState(f)
  assert.equal(f.layers.size, 1)
  const tokens = f.layers.get(PACKAGE)
  assert.ok(tokens && Object.keys(tokens).length > 0)
  for (const [key, value] of Object.entries(tokens)) {
    assert.match(key, /^--dsw-/)
    assert.equal(typeof value.light, 'string')
    assert.equal(typeof value.dark, 'string')
    assert.ok(value.light.length > 0 && value.dark.length > 0)
  }
  f.setMode('light')
  assert.equal(f.resolvedTokens()['--dsw-alias-bg-base'], tokens['--dsw-alias-bg-base'].light)
  f.setMode('dark')
  assert.equal(f.resolvedTokens()['--dsw-alias-bg-base'], tokens['--dsw-alias-bg-base'].dark)
  assert.notEqual(tokens['--dsw-alias-bg-base'].light, tokens['--dsw-alias-bg-base'].dark)
  assert.equal(body.getAttribute('data-ds-dark-theme'), '', 'native theme preference is preserved')
  assert.equal(f.document.querySelectorAll('style[data-plugin="dsh-display-roselia"]').length, 1)
  assert.equal(f.entries.size, SLOT_NAMES.length)

  const detachedSceneButton = select(f, 'button[data-scene="live"]')
  f.dispose()
  f.dispose()
  assert.equal(f.layers.size, 0)
  assert.deepEqual(f.resolvedTokens(), { '--dsw-alias-bg-base': 'original-base' })
  assert.equal(f.entries.size, 0)
  assert.equal(f.watchers.size, 0)
  assert.equal(f.effects.size, 0)
  assert.equal(f.document.head.innerHTML, priorHead)
  assert.equal(body.innerHTML, '<main id="host">Host content</main>')
  assert.equal(body.getAttribute('data-roselia-display'), 'before')
  assert.equal(body.getAttribute('data-roselia-scene'), 'before-scene')
  assert.equal(body.hasAttribute('data-roselia-artwork'), false)
  assert.equal(body.hasAttribute('data-roselia-member'), false)
  assert.equal(body.style.getPropertyValue('--roselia-strength'), '0.2')
  assert.equal(body.style.getPropertyPriority('--roselia-strength'), 'important')
  assert.equal(body.style.getPropertyValue('--roselia-member-image'), previousImage)
  assert.equal(body.style.getPropertyPriority('--roselia-member-image'), 'important')
  assert.equal(body.style.getPropertyValue('--unrelated'), 'untouched')
  detachedSceneButton.click()
  f.window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, scene: 'live' }))
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: STORAGE_KEY }))
  assert.equal(body.getAttribute('data-roselia-scene'), 'before-scene', 'unload aborts stale event listeners')
})

test('slot injections wait for their owners, survive redeclaration, and cancel pending waits on unload', t => {
  const f = fixture(t, { declared: [] })
  f.activate()
  assert.equal(f.entries.size, 0)
  assert.equal(f.watchers.size, SLOT_NAMES.length)
  for (const name of SLOT_NAMES) {
    f.declare(name)
    assert.equal(f.entries.get(name).length, 1)
    if (BRAND_SLOTS.includes(name)) assert.equal(f.entries.get(name)[0].options.priority, -100)
    f.declare(name, false)
    assert.equal(f.entries.has(name), false)
    f.declare(name)
    assert.equal(f.entries.get(name).length, 1)
  }
  f.dispose()
  assert.equal(f.entries.size, 0)
  assert.equal(f.watchers.size, 0)
  f.declare('sidebar.brand.mark', false)
  f.declare('sidebar.brand.mark')
  assert.equal(f.entries.size, 0)
})

test('rendered brand marks honor DSH owner geometry and the official wordmark remains offline', t => {
  const f = fixture(t)
  f.activate()
  const sidebar = f.renderSlot('sidebar.brand.mark', { size: 24, className: 'host-sidebar-mark' })
  const hero = f.renderSlot('conversation.hero.brand.mark', { size: 34, className: 'host-hero-mark' })
  assert.equal(sidebar.querySelector('svg').getAttribute('width'), '24')
  assert.equal(hero.querySelector('svg').getAttribute('height'), '34')
  assert.ok(hero.querySelector('svg').classList.contains('host-hero-mark'))
  const name = f.renderSlot('sidebar.brand.name')
  const logo = name.querySelector('img')
  assert.equal(logo.alt, 'Roselia')
  assert.match(logo.src, /^data:image\/png;base64,iVBOR/)
  assert.equal(logo.draggable, false)
})

test('scene, member, intensity and artwork controls persist coherent preferences and reset to defaults', t => {
  const f = fixture(t)
  f.activate()
  select(f, 'button[data-scene="live"]').click()
  assert.equal(f.document.body.getAttribute('data-roselia-scene'), 'live')
  assert.equal(select(f, 'button[data-scene="live"]').getAttribute('aria-pressed'), 'true')
  assert.equal(select(f, 'button[data-scene="nocturne"]').getAttribute('aria-pressed'), 'false')
  select(f, 'button[data-member="rinko"]').click()
  assert.equal(f.document.body.getAttribute('data-roselia-member'), 'rinko')
  assert.match(f.document.body.style.getPropertyValue('--roselia-member-image'), /data:image\/webp;base64,/)
  const range = select(f, 'input[aria-label="氛围强度"]')
  range.value = '30'
  range.dispatchEvent(new f.window.Event('input', { bubbles: true }))
  assert.equal(f.document.body.style.getPropertyValue('--roselia-strength'), '0.3')
  assert.equal(select(f, 'output').value, '30%')
  const check = select(f, 'input[type="checkbox"]')
  check.click()
  assert.equal(f.document.body.getAttribute('data-roselia-artwork'), 'false')
  assert.deepEqual(stored(f), { version: 2, scene: 'live', member: 'rinko', intensity: 30, artwork: false })
  select(f, 'button[data-member="yukina"]').click()
  assert.equal(check.checked, true, 'choosing a member enables their artwork')
  select(f, 'button[data-scene="quiet"]').click()
  assert.equal(range.disabled, true)
  assert.equal(check.disabled, true)
  assert.ok(select(f, 'button[data-member="yukina"]').matches(':disabled'))
  select(f, '.roselia-reset').click()
  assertDefaultState(f)
  assert.equal(range.disabled, false)
  assert.equal(check.disabled, false)
  assert.deepEqual(stored(f), { version: 2, ...DEFAULTS })
})

test('native dialog controls close and restore focus, without intercepting the browser cancel action', t => {
  const f = fixture(t)
  f.activate()
  const launcher = select(f, 'button[aria-label="打开 Roselia 主题设置"]')
  const dialog = select(f, 'dialog')
  const close = select(f, 'button[aria-label="关闭主题设置"]')
  assert.equal(launcher.getAttribute('aria-haspopup'), 'dialog')
  assert.equal(f.document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Roselia 主题')
  launcher.click()
  launcher.click()
  assert.equal(dialog.open, true)
  close.click()
  assert.equal(dialog.open, false)
  assert.equal(f.document.activeElement, launcher)
  launcher.click()
  const cancel = new f.window.Event('cancel', { cancelable: true })
  assert.equal(dialog.dispatchEvent(cancel), true, 'Escape may use the native dialog cancel default action')
  dialog.close() // Model the uncancelled native action; actual key dispatch is a browser check.
  assert.equal(f.document.activeElement, launcher)
  launcher.click()
  dialog.getBoundingClientRect = () => ({ top: 10, right: 100, bottom: 100, left: 10 })
  dialog.dispatchEvent(new f.window.MouseEvent('click', { clientX: 5, clientY: 5, bubbles: true }))
  assert.equal(dialog.open, false)
  launcher.click()
  f.dispose()
  assert.equal(dialog.open, false)
  assert.equal(dialog.isConnected, false)
  launcher.click()
  assert.equal(dialog.open, false, 'unloaded launchers cannot reopen a detached dialog')
})

for (const badValue of ['{broken', 'null', '[]', '42', '{"scene":"external","intensity":"100","artwork":0,"member":"unknown"}']) {
  test(`invalid persisted preferences recover without breaking activation: ${badValue}`, t => {
    const f = fixture(t)
    f.window.localStorage.setItem(STORAGE_KEY, badValue)
    f.activate()
    assertDefaultState(f)
  })
}

test('persisted numeric values are clamped and fractional intensities are rounded', t => {
  const f = fixture(t)
  f.window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scene: 'live', intensity: 150, artwork: false, member: 'lisa' }))
  f.activate()
  assert.equal(select(f, 'input[type="range"]').value, '100')
  assert.equal(f.document.body.getAttribute('data-roselia-member'), 'lisa')
  assert.equal(f.document.body.getAttribute('data-roselia-artwork'), 'false')
  for (const [intensity, expected] of [[-80, 0], [42.7, 43]]) {
    f.window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, intensity }))
    f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: STORAGE_KEY }))
    assert.equal(select(f, 'input[type="range"]').value, String(expected))
  }
})

test('storage denial still applies controls and reports that the preference could not be saved', t => {
  const f = fixture(t)
  Object.defineProperty(f.window, 'localStorage', { configurable: true, get() { throw new Error('Storage denied') } })
  assert.doesNotThrow(() => f.activate())
  assertDefaultState(f)
  select(f, 'button[data-scene="live"]').click()
  assert.equal(f.document.body.getAttribute('data-roselia-scene'), 'live')
  assert.match(select(f, '[role="status"]').textContent, /不允许保存/)
})

test('storage changes from another window sync while unrelated keys are ignored', t => {
  const f = fixture(t)
  f.activate()
  f.window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scene: 'live', intensity: 20, artwork: false, member: 'ako' }))
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: 'other.plugin' }))
  assertDefaultState(f)
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: STORAGE_KEY }))
  assert.equal(f.document.body.getAttribute('data-roselia-scene'), 'live')
  assert.equal(f.document.body.getAttribute('data-roselia-member'), 'ako')
  assert.equal(select(f, 'input[type="range"]').value, '20')
  f.window.localStorage.clear()
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: null }))
  assertDefaultState(f)
})

test('unload and reload are repeatable and preserve saved preferences without duplicate nodes or registrations', t => {
  const f = fixture(t)
  f.activate()
  select(f, 'button[data-member="sayo"]').click()
  f.dispose()
  const next = makeContext()
  t.after(() => next.dispose())
  f.plugin.apply(next.ctx)
  assert.equal(f.document.body.getAttribute('data-roselia-member'), 'sayo')
  assert.equal(f.document.querySelectorAll('.roselia-launcher').length, 1)
  assert.equal(f.document.querySelectorAll('.roselia-dialog').length, 1)
  assert.equal(f.document.querySelectorAll('style[data-plugin="dsh-display-roselia"]').length, 1)
  assert.equal(next.layers.size, 1)
  for (const entries of next.entries.values()) assert.equal(entries.length, 1)
  next.dispose()
  assert.equal(f.document.body.innerHTML, '<main id="host">Host content</main>')
  assert.equal(f.document.body.hasAttribute('data-roselia-display'), false)
})

test('all visual assets use embedded data or local Blob URLs with no unresolved placeholders or remote CSS fetches', t => {
  const f = fixture(t)
  f.activate()
  const css = [...f.document.querySelectorAll('style[data-plugin-css^="dsh-display-roselia/"]')].map(style => style.textContent).join('\n')
  assert.doesNotMatch(css, /ROSELIA_WALLPAPER|ROSELIA_LIVE|@import/)
  const imageURLs = [...css.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)]
    .map(match => match[1] ?? match[2] ?? match[3])
  for (const node of f.document.querySelectorAll('[style]')) {
    for (const match of node.getAttribute('style').matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)) {
      imageURLs.push(match[1] ?? match[2] ?? match[3])
    }
  }
  for (const image of f.document.querySelectorAll('img')) imageURLs.push(image.src)
  assert.ok(imageURLs.length >= 10)
  for (const url of imageURLs) {
    if (url.startsWith('blob:')) {
      assert.equal(new URL(url.slice(5)).origin, f.window.location.origin)
      assert.ok(f.activeObjectURLs.has(url), 'every local object URL is backed by a live Blob')
    } else {
      assert.match(url, /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/)
    }
  }
  assert.match(css, /prefers-reduced-motion/)
})

test('the large wallpaper uses a short local Blob URL and releases its exact image bytes on unload', async t => {
  const f = fixture(t)
  assert.equal(f.createdObjectURLs.length, 0, 'loading the factory must not allocate image resources')
  f.activate()
  assert.equal(f.createdObjectURLs.length, 1)
  const { url, blob } = f.createdObjectURLs[0]
  assert.equal(blob.type, 'image/png')
  assert.equal(blob.size, wallpaperBytes.length)
  const bytes = await new Promise((resolve, reject) => {
    const reader = new f.window.FileReader()
    reader.onload = () => resolve(Buffer.from(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  assert.deepEqual(bytes, wallpaperBytes, 'data URL decoding must preserve the original PNG')
  const css = select(f, 'style[data-plugin="dsh-display-roselia"]').textContent
  assert.ok(css.includes(url), 'the visible scene uses the short URL')
  const sceneValues = [...css.matchAll(/--roselia-scene-image:([^;}]*)/g)].map(match => match[1])
  assert.ok(sceneValues.some(value => value.includes(url)))
  assert.ok(sceneValues.every(value => value.length < 1024 * 1024), 'CSS variable values stay below Chromium limits')
  assert.equal(f.revokedObjectURLs.length, 0)
  f.dispose()
  f.dispose()
  assert.deepEqual(f.revokedObjectURLs, [url])
  assert.equal(f.activeObjectURLs.size, 0)
})

test('the untouched v0.1 defaults migrate to the member stage without overwriting deliberate choices', t => {
  const f = fixture(t)
  f.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(LEGACY_DEFAULTS))
  f.activate()
  assertDefaultState(f)
  assert.equal(select(f, 'button[data-member="random"]').getAttribute('aria-pressed'), 'true')
})

for (const [description, preferences] of [
  ['explicit v2 moonlight selection', { ...LEGACY_DEFAULTS, version: 2 }],
  ['legacy fixed member', { ...LEGACY_DEFAULTS, member: 'sayo' }],
  ['legacy clean scene', { ...LEGACY_DEFAULTS, scene: 'quiet' }],
  ['legacy custom intensity', { ...LEGACY_DEFAULTS, intensity: 40 }],
]) {
  test(`migration preserves ${description}`, t => {
    const f = fixture(t)
    f.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    f.activate()
    assert.equal(f.document.body.getAttribute('data-roselia-scene'), preferences.scene)
    assert.equal(f.document.body.getAttribute('data-roselia-member-preference'), preferences.member)
    assert.equal(select(f, 'input[aria-label="氛围强度"]').value, String(preferences.intensity))
  })
}

const CHARACTER_IDS = ['yukina', 'sayo', 'lisa', 'ako', 'rinko']
const mutationsSettled = () => new Promise(resolve => setTimeout(resolve, 0))
function resolvedMember(f) { return f.document.body.getAttribute('data-roselia-member') }
function heroOwner(f, sessionId = 'home-1') {
  const owner = f.document.createElement('main')
  owner.setAttribute('data-conversation-content', '')
  owner.setAttribute('data-content-phase', 'hero')
  owner.setAttribute('data-conversation-session', sessionId)
  const panel = f.document.createElement('div')
  panel.setAttribute('data-slot', 'main.conversation')
  panel.append(owner)
  f.document.body.append(panel)
  return owner
}

test('random member changes only on a new homepage visit and respects a fixed-member override', async t => {
  const f = fixture(t)
  f.window.Math.random = () => 0
  f.activate()
  const owner = heroOwner(f)
  f.renderSlot('conversation.hero.brand.mark', { size: 34 }, { container: owner })
  await mutationsSettled()
  const first = resolvedMember(f)
  assert.ok(CHARACTER_IDS.includes(first), 'the homepage shows an actual Roselia member')
  assert.match(f.document.body.style.getPropertyValue('--roselia-member-image'), /data:image\/webp;base64,/)
  owner.setAttribute('data-unrelated', 'changed')
  owner.setAttribute('data-content-phase', 'hero')
  await mutationsSettled()
  assert.equal(resolvedMember(f), first, 'ordinary updates must not flicker to a different character')
  owner.setAttribute('data-content-phase', 'active')
  await mutationsSettled()
  assert.equal(resolvedMember(f), first, 'entering a conversation is not a new homepage visit')
  owner.setAttribute('data-content-phase', 'hero')
  await mutationsSettled()
  const second = resolvedMember(f)
  assert.notEqual(second, first, 'returning home chooses another member even with deterministic randomness')
  owner.setAttribute('data-conversation-session', 'home-2')
  await mutationsSettled()
  const third = resolvedMember(f)
  assert.notEqual(third, second, 'a new blank conversation is a new homepage visit')
  select(f, 'button[data-member="rinko"]').click()
  owner.setAttribute('data-conversation-session', 'home-3')
  await mutationsSettled()
  assert.equal(resolvedMember(f), 'rinko')
  assert.equal(f.document.body.getAttribute('data-roselia-member-preference'), 'rinko')
  select(f, 'button[data-member="all"]').click()
  owner.setAttribute('data-conversation-session', 'home-4')
  await mutationsSettled()
  assert.equal(resolvedMember(f), 'all', 'the explicit band portrait remains supported')
  f.dispose()
  owner.setAttribute('data-conversation-session', 'home-after-unload')
  await mutationsSettled()
  assert.equal(f.document.body.hasAttribute('data-roselia-member'), false, 'disposed observers cannot repopulate plugin attributes')
})

test('random member avoids an immediate repeat across reload without changing the stored random preference', async t => {
  const f = fixture(t)
  f.window.Math.random = () => 0
  f.activate()
  const owner = heroOwner(f)
  f.renderSlot('conversation.hero.brand.mark', { size: 34 }, { container: owner })
  await mutationsSettled()
  select(f, 'button[data-member="random"]').click()
  const first = resolvedMember(f)
  assert.equal(stored(f).member, 'random')
  f.dispose()
  const next = makeContext()
  t.after(() => next.dispose())
  f.plugin.apply(next.ctx)
  assert.ok(CHARACTER_IDS.includes(resolvedMember(f)))
  assert.notEqual(resolvedMember(f), first)
  assert.equal(stored(f).member, 'random', 'a random result must not become a fixed saved member')
  next.dispose()
})

function reasoningDirectory(patch = {}) {
  return makeDirectory({
    current: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' },
    routable: true,
    groups: [{ id: 'test-provider', name: 'Test provider', models: [{
      id: 'test-model', name: 'Test model',
      reasoning: {
        defaultEffort: 'high',
        efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
      },
    }] }],
    ...patch,
  })
}

function rangeInput(f, range, value) {
  // Bypass React's value tracker as a real browser's native range action does.
  Object.getOwnPropertyDescriptor(f.window.HTMLInputElement.prototype, 'value').set.call(range, String(value))
  flushSync(() => range.dispatchEvent(new f.window.Event('input', { bubbles: true })))
}

function pointer(f, node, type) {
  const event = new f.window.MouseEvent(type, { bubbles: true, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  flushSync(() => node.dispatchEvent(event))
}

async function renderReasoning(f, props = {}, { open = true } = {}) {
  // The official model seat passes a locked owner flag plus session context.
  const container = f.renderSlot(REASONING_SLOT, { sessionId: 'test-session', locked: false, ...props })
  await mutationsSettled()
  const trigger = container.querySelector('button[aria-haspopup="dialog"]')
  if (open && trigger !== null) {
    flushSync(() => trigger.click())
    await mutationsSettled()
  }
  return container
}

test('reasoning slider reads the official catalog and commits only its declared levels through the shared directory', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  assert.ok(range, 'the public composer control opens its slider only on request')
  assert.equal(range.min, '0')
  assert.equal(range.max, '2', 'sparse adapter levels stay sparse')
  assert.equal(range.step, '1')
  assert.equal(range.value, '1')
  assert.ok(directory.loads >= 1)
  assert.deepEqual(directory.selections, [], 'mounting never changes the user’s current model or effort')
  rangeInput(f, range, 2)
  await mutationsSettled()
  assert.deepEqual(directory.selections, [{ provider: 'test-provider', model: 'test-model', reasoningEffort: 'max' }])
  assert.equal(range.value, '2')
  flushSync(() => directory.publish({ current: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'off' } }))
  assert.equal(range.value, '0', 'changes made through the native selector immediately reflect in the slider')
  assert.equal(directory.selections.length, 1, 'store notifications do not write back to the host')
})

test('dragging reasoning previews locally and submits a single selection when released', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  const popup = range.closest('[role="dialog"]')
  const visualState = () => ({
    progress: Number(popup.style.getPropertyValue('--effort-progress')),
    particles: popup.querySelectorAll('.roselia-effort-particles i').length,
  })
  pointer(f, range, 'pointerdown')
  rangeInput(f, range, 0)
  assert.deepEqual(visualState(), { progress: 0, particles: 4 }, 'the lowest preview has a quiet four-particle effect')
  rangeInput(f, range, 1)
  const middle = visualState()
  assert.equal(middle.progress, 0.5)
  assert.ok(middle.particles > 4 && middle.particles < 16, 'an intermediate level increases the effect progressively')
  rangeInput(f, range, 2)
  assert.deepEqual(visualState(), { progress: 1, particles: 16 }, 'the highest preview has the strongest particle effect')
  assert.equal(directory.selections.length, 0, 'visual previews must not issue a series of backend changes')
  pointer(f, range, 'pointerup')
  await mutationsSettled()
  assert.deepEqual(directory.selections, [{ provider: 'test-provider', model: 'test-model', reasoningEffort: 'max' }])
  assert.deepEqual(visualState(), { progress: 1, particles: 16 }, 'release retains the committed visual strength')
  flushSync(() => directory.publish({ current: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'off' } }))
  assert.deepEqual(visualState(), { progress: 0, particles: 4 }, 'an external effort change also updates the visual effect')
  assert.equal(directory.selections.length, 1, 'visual synchronization does not write back another selection')
})

for (const [description, options, patch] of [
  ['a missing model selection', {}, { current: null }],
  ['an unavailable route', {}, { routable: false }],
  ['an undeclared current effort', {}, { current: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'unknown' } }],
  ['an addressed subagent', { subagent: true }, {}],
]) {
  test(`reasoning slider does not offer misleading controls for ${description}`, async t => {
    const directory = reasoningDirectory(patch)
    const f = fixture(t, { directory, ...options })
    f.activate()
    const container = await renderReasoning(f)
    assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
    assert.deepEqual(directory.selections, [])
    if (options.subagent) assert.equal(directory.loads, 0)
  })
}

test('models with no reasoning metadata have no slider and never receive an invented effort', async t => {
  const directory = reasoningDirectory({
    groups: [{ id: 'test-provider', name: 'Test provider', models: [{ id: 'test-model', name: 'Test model' }] }],
  })
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  assert.deepEqual(directory.selections, [])
})

test('an in-flight shared selection disables the slider, and a failed change reports the error without faking success', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  flushSync(() => directory.publish({ status: 'selecting', pending: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'max' } }))
  assert.equal(range.getAttribute('aria-disabled'), 'true')
  flushSync(() => directory.publish({ status: 'ready', pending: null }))
  assert.notEqual(range.getAttribute('aria-disabled'), 'true')
  directory.setSelectionHandler(async () => ({ ok: false, error: { code: 'session/writer-held', message: 'Another DSH owns this session' } }))
  rangeInput(f, range, 2)
  await mutationsSettled()
  assert.equal(range.value, '1', 'a failed save returns to the actual selected effort')
  assert.match(f.document.querySelector('[role="dialog"][aria-label="选择模型与推理强度"] [role="status"]').textContent, /DSH|占用|另一窗口|Another|writer/i)
  assert.notEqual(range.getAttribute('aria-disabled'), 'true')
})

test('a model switch during a drag invalidates the stale preview before it can change another model', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  pointer(f, range, 'pointerdown')
  rangeInput(f, range, 2)
  flushSync(() => directory.publish({ current: { provider: 'other-provider', model: 'other-model', reasoningEffort: 'high' } }))
  pointer(f, range, 'pointerup')
  await mutationsSettled()
  assert.deepEqual(directory.selections, [], 'release cannot replay a stale route captured before a model switch')
})

test('initial homepage session hydration does not reroll the member, and embedded heroes do not own the main backdrop', async t => {
  const f = fixture(t)
  f.window.Math.random = () => 0
  f.activate()
  const owner = heroOwner(f)
  owner.removeAttribute('data-conversation-session')
  const mainMark = f.renderSlot('conversation.hero.brand.mark', { size: 34 }, { container: owner })
  await mutationsSettled()
  const first = resolvedMember(f)
  owner.setAttribute('data-conversation-session', 'hydrated-first-session')
  await mutationsSettled()
  assert.equal(resolvedMember(f), first, 'initial binding arrival is still the same homepage visit')
  const embedded = f.document.createElement('aside')
  embedded.setAttribute('data-conversation-content', '')
  embedded.setAttribute('data-content-phase', 'hero')
  embedded.setAttribute('data-conversation-session', 'embedded-session')
  f.document.body.append(embedded)
  const embeddedMark = f.renderSlot('conversation.hero.brand.mark', { size: 34 }, { container: embedded })
  await mutationsSettled()
  embedded.setAttribute('data-conversation-session', 'embedded-session-2')
  await mutationsSettled()
  assert.equal(resolvedMember(f), first)
  owner.setAttribute('data-conversation-session', 'new-main-home')
  await mutationsSettled()
  assert.notEqual(resolvedMember(f), first, 'the main owner keeps its observer when an embedded hero mounts')
  const second = resolvedMember(f)
  f.unmountSlot(embeddedMark)
  f.unmountSlot(mainMark)
  f.renderSlot('conversation.hero.brand.mark', { size: 34 }, { container: owner })
  await mutationsSettled()
  assert.notEqual(resolvedMember(f), second, 'leaving and mounting the homepage again counts as a new visit')
})

test('a model without an explicit default can return to the provider default without fabricating an effort ID', async t => {
  const directory = reasoningDirectory({
    groups: [{ id: 'test-provider', name: 'Test provider', models: [{
      id: 'test-model', name: 'Test model', reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] },
    }] }],
  })
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  assert.equal(range.max, '2')
  rangeInput(f, range, 0)
  await mutationsSettled()
  assert.deepEqual(directory.selections, [{ provider: 'test-provider', model: 'test-model' }])
  assert.equal(range.getAttribute('aria-valuetext'), '默认')
})

test('cancelled reasoning drags restore the selected value without submitting a choice', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  pointer(f, range, 'pointerdown')
  rangeInput(f, range, 2)
  assert.equal(range.value, '2')
  pointer(f, range, 'pointercancel')
  assert.equal(range.value, '1')
  pointer(f, range, 'pointerup')
  await mutationsSettled()
  assert.deepEqual(directory.selections, [])
})

test('unmounting reasoning cancels subscriptions and safely ignores a late asynchronous rejection', async t => {
  const directory = reasoningDirectory()
  let rejectSelection
  directory.setSelectionHandler(() => new Promise((resolve, reject) => { rejectSelection = reject }))
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  assert.ok(directory.listeners.size > 0)
  rangeInput(f, range, 2)
  assert.equal(range.getAttribute('aria-disabled'), 'true')
  assert.equal(directory.selections.length, 1)
  f.unmountSlot(container)
  assert.equal(directory.listeners.size, 0)
  rejectSelection(new Error('Connection closed after unmount'))
  await mutationsSettled()
  assert.equal(f.document.querySelector('[data-roselia-reasoning]'), null)
  assert.equal(directory.selections.length, 1)
})

test('successive keyboard effort changes retain focus while pending without submitting extra input', async t => {
  const directory = reasoningDirectory()
  let finishSelection
  directory.setSelectionHandler(selection => {
    directory.publish({ status: 'selecting', pending: selection })
    return new Promise(resolve => {
      finishSelection = () => {
        directory.publish({ current: selection, status: 'ready', pending: null })
        resolve({ ok: true, value: undefined })
      }
    })
  })
  const f = fixture(t, { directory })
  f.activate()
  await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  assert.ok(f.document.activeElement === range, 'opening the control focuses the native range')
  for (const target of [2, 1]) {
    const before = directory.selections.length
    flushSync(() => range.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: target === 2 ? 'End' : 'ArrowLeft', bubbles: true })))
    rangeInput(f, range, target)
    assert.equal(range.getAttribute('aria-disabled'), 'true')
    assert.equal(range.disabled, false, 'the range stays natively focusable while pending')
    assert.ok(f.document.activeElement === range, 'a pending save does not remove keyboard focus')
    rangeInput(f, range, 0)
    assert.equal(directory.selections.length, before + 1, 'busy input is guarded against extra backend requests')
    finishSelection()
    await mutationsSettled()
    assert.notEqual(range.getAttribute('aria-disabled'), 'true')
    assert.equal(range.value, String(target))
    assert.ok(f.document.activeElement === range, 'the next native arrow key still reaches the slider')
  }
  assert.deepEqual(directory.selections.map(selection => selection.reasoningEffort), ['max', 'high'])
})

test('finishing an effort change never steals focus from another control selected while waiting', async t => {
  const directory = reasoningDirectory()
  let finishSelection
  directory.setSelectionHandler(selection => new Promise(resolve => {
    finishSelection = () => {
      directory.publish({ current: selection })
      resolve({ ok: true, value: undefined })
    }
  }))
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  const other = select(f, '.roselia-launcher')
  range.focus()
  rangeInput(f, range, 2)
  assert.equal(range.getAttribute('aria-disabled'), 'true')
  other.focus()
  finishSelection()
  await mutationsSettled()
  assert.notEqual(range.getAttribute('aria-disabled'), 'true')
  assert.ok(f.document.activeElement === other, 'the user’s new focus target is preserved')
})

test('the reasoning slider stays hidden until requested, opens without writing, and closes with Escape back to its trigger', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f, {}, { open: false })
  const trigger = container.querySelector('button[aria-haspopup="dialog"]')
  assert.ok(trigger, 'eligible models have a compact reasoning control')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.match(trigger.getAttribute('aria-label'), /选择模型与推理强度.*Test model.*High/)
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  assert.equal(f.document.querySelector('[role="dialog"][aria-label="选择模型与推理强度"]'), null)
  assert.deepEqual(directory.selections, [])
  flushSync(() => trigger.click())
  await mutationsSettled()
  const dialog = f.document.querySelector('[role="dialog"][aria-label="选择模型与推理强度"]')
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  assert.ok(dialog && range)
  assert.equal(dialog.querySelector('.roselia-effort-emblem'), null, 'the unified control has no decorative fast-mode lightning emblem')
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.ok(f.document.activeElement === range)
  assert.deepEqual(directory.selections, [], 'opening the picker never changes the actual model selection')
  flushSync(() => range.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await mutationsSettled()
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  assert.ok(f.document.activeElement === trigger, 'Escape restores the originating control')
  assert.deepEqual(directory.selections, [])
  flushSync(() => trigger.click())
  await mutationsSettled()
  flushSync(() => trigger.click())
  await mutationsSettled()
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  assert.ok(f.document.activeElement === trigger, 'toggling the trigger closes the same picker')
})

test('outside pointer interactions close the reasoning popup without stealing the new focus or committing a draft', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const trigger = container.querySelector('button[aria-haspopup="dialog"]')
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  pointer(f, range, 'pointerdown')
  rangeInput(f, range, 2)
  assert.deepEqual(directory.selections, [])
  const other = select(f, '.roselia-launcher')
  pointer(f, other, 'pointerdown')
  other.focus()
  await mutationsSettled()
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.ok(f.document.activeElement === other)
  assert.deepEqual(directory.selections, [])
  flushSync(() => trigger.click())
  await mutationsSettled()
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]').value, '1', 'reopening displays the saved effort, not an abandoned drag preview')
})

test('restoring the model default submits its declared default effort and leaves the picker open', async t => {
  const directory = reasoningDirectory({ current: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'max' } })
  const f = fixture(t, { directory })
  f.activate()
  await renderReasoning(f)
  const reset = select(f, 'button[aria-label="恢复模型默认推理强度"]')
  flushSync(() => reset.click())
  await mutationsSettled()
  assert.deepEqual(directory.selections, [{ provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' }])
  const range = f.document.querySelector('input[aria-label="推理强度"]')
  assert.ok(range)
  assert.equal(range.value, '1')
})

test('cold reasoning startup declares the transitive service dependencies read by the official model directory', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory })
  f.activate()
  assert.deepEqual(f.directoryRequests, [], 'registration alone must not eagerly resolve a session')
  const container = await renderReasoning(f, {}, { open: false })
  assert.equal(f.directoryRequests.length, 1, 'the first mounted control resolves its own cold session directory')
  const request = f.directoryRequests[0]
  for (const dependency of ['modelDirectories', 'sessions', 'remote', 'remote.session']) {
    assert.ok(request.injected.includes(dependency), `${dependency} must be available through the calling Cordis scope`)
  }
  assert.ok(container.querySelector('button[aria-haspopup="dialog"]'))
  assert.ok(directory.loads >= 1)
  assert.deepEqual(directory.selections, [], 'cold initialization reads capabilities without changing a model')
})

for (const missing of ['remote', 'remote.session']) {
  test(`an unavailable ${missing} service defers reasoning while keeping the theme usable`, t => {
    const f = fixture(t, { missingServices: [missing] })
    assert.doesNotThrow(() => f.activate())
    assertDefaultState(f)
    assert.equal(f.layers.size, 1)
    for (const slot of BRAND_SLOTS) assert.equal(f.entries.get(slot)?.length, 1)
    assert.equal(f.entries.has(REASONING_SLOT), false, 'the optional control cannot activate with an incomplete connection')
    assert.deepEqual(f.directoryRequests, [])
    assert.ok(select(f, '.roselia-launcher'))
    f.dispose()
    assert.equal(f.layers.size, 0)
    assert.equal(f.entries.size, 0)
  })
}

test('one official model-seat replacement shadows the native entry and unloading restores it', async t => {
  const directory = reasoningDirectory()
  const f = fixture(t, { directory, nativeModel: true })
  const original = f.entries.get(REASONING_SLOT)[0]
  f.activate()
  const occupants = f.entries.get(REASONING_SLOT)
  assert.equal(occupants.length, 2, 'the original occupant remains registered under its own lifetime')
  assert.equal(occupants[0].options.priority, -100)
  assert.ok(occupants[1] === original)
  assert.equal(f.entries.has('conversation.input.right'), false, 'the theme adds no separate effort button')
  assert.equal(f.entries.has('conversation.input.dock'), false, 'the theme adds no permanent slider row')
  const container = await renderReasoning(f, {}, { open: false })
  assert.equal(container.querySelectorAll('button').length, 1, 'model and effort share one collapsed control')
  assert.match(container.textContent, /Test model/)
  assert.match(container.textContent, /High/)
  assert.equal(container.querySelector('[data-native-model-selector]'), null)
  f.unmountSlot(container)
  f.dispose()
  assert.equal(f.entries.get(REASONING_SLOT).length, 1)
  assert.ok(f.entries.get(REASONING_SLOT)[0] === original)
  const restored = f.renderSlot(REASONING_SLOT, { sessionId: 'test-session', locked: false })
  assert.ok(restored.querySelector('[data-native-model-selector]'), 'normal slot resolution restores the shipped selector')
})

function multiModelDirectory(patch = {}) {
  return reasoningDirectory({
    groups: [
      { id: 'test-provider', name: 'Test provider', models: [
        { id: 'test-model', name: 'Test model', reasoning: { defaultEffort: 'high', efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] } },
        { id: 'plain-model', name: 'Plain model' },
        { id: 'swift-model', name: 'Swift model', reasoning: { defaultEffort: 'off', efforts: [{ id: 'off', name: 'Off' }, { id: 'medium', name: 'Medium' }] } },
      ] },
      { id: 'second-provider', name: 'Second provider', models: [
        { id: 'test-model', name: 'Other provider model', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'provider-default', name: 'Provider default model', reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] } },
      ] },
    ],
    ...patch,
  })
}

async function openModelList(f) {
  const change = f.document.querySelector('button[aria-label^="切换模型"]')
  if (change) {
    flushSync(() => change.click())
    await mutationsSettled()
  }
  const list = f.document.querySelector('[role="listbox"][aria-label="可用模型"]')
  assert.ok(list, 'the unified popup exposes the real provider catalog')
  return list
}

function modelOption(f, name) {
  const option = [...f.document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes(name))
  assert.ok(option, `missing model option ${name}`)
  return option
}

async function chooseModel(f, name) {
  await openModelList(f)
  const option = modelOption(f, name)
  flushSync(() => option.click())
  await mutationsSettled()
}

test('the unified picker lists provider groups and applies the destination model default using its full route', async t => {
  const directory = multiModelDirectory({ current: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'max' } })
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const list = await openModelList(f)
  assert.match(list.textContent, /Test provider/)
  assert.match(list.textContent, /Second provider/)
  assert.equal(f.document.querySelectorAll('[role="option"]').length, 5)
  assert.equal(modelOption(f, 'Test model').getAttribute('aria-selected'), 'true')
  await chooseModel(f, 'Other provider model')
  assert.deepEqual(directory.selections, [{ provider: 'second-provider', model: 'test-model', reasoningEffort: 'low' }],
    'identical model IDs on different providers must remain distinct routes')
  assert.match(container.textContent, /Other provider model/)
  assert.match(container.textContent, /Low/)
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]').getAttribute('aria-valuetext'), 'Low')
})

test('selecting the same model keeps a valid custom effort and does not issue a redundant request', async t => {
  const directory = multiModelDirectory({ current: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'max' } })
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  await chooseModel(f, 'Test model')
  assert.deepEqual(directory.selections, [])
  assert.match(container.textContent, /Max/)
})

test('models without reasoning still provide the unified model chooser and never inherit another model’s effort', async t => {
  const directory = multiModelDirectory({ current: { provider: 'test-provider', model: 'plain-model' } })
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  assert.match(container.textContent, /Plain model/)
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  await chooseModel(f, 'Swift model')
  assert.deepEqual(directory.selections.at(-1), { provider: 'test-provider', model: 'swift-model', reasoningEffort: 'off' })
  assert.ok(f.document.querySelector('input[aria-label="推理强度"]'))
  await chooseModel(f, 'Plain model')
  assert.deepEqual(directory.selections.at(-1), { provider: 'test-provider', model: 'plain-model' })
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  await chooseModel(f, 'Provider default model')
  assert.deepEqual(directory.selections.at(-1), { provider: 'second-provider', model: 'provider-default' })
})

test('a rejected model switch preserves the saved choice and exposes a retryable error in the open picker', async t => {
  const directory = multiModelDirectory()
  directory.setSelectionHandler(async () => ({ ok: false, error: { code: 'model/unavailable', message: 'This model is unavailable' } }))
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  await chooseModel(f, 'Swift model')
  assert.deepEqual(directory.selections, [{ provider: 'test-provider', model: 'swift-model', reasoningEffort: 'off' }])
  assert.match(container.textContent, /Test model/)
  assert.doesNotMatch(container.textContent, /Swift model/)
  const dialog = f.document.querySelector('[role="dialog"][aria-label="选择模型与推理强度"]')
  assert.ok(dialog, 'a failure leaves the picker available for retry')
  assert.match(dialog.querySelector('[role="status"]').textContent, /unavailable/)
  assert.equal(modelOption(f, 'Test model').getAttribute('aria-selected'), 'true')
})

test('the official locked owner state prevents opening the combined model and effort control', async t => {
  const directory = multiModelDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f, { locked: true }, { open: false })
  const trigger = container.querySelector('button[aria-haspopup="dialog"]')
  assert.ok(trigger)
  assert.ok(trigger.disabled || trigger.getAttribute('aria-disabled') === 'true')
  flushSync(() => trigger.click())
  await mutationsSettled()
  assert.equal(f.document.querySelector('[role="dialog"][aria-label="选择模型与推理强度"]'), null)
  assert.deepEqual(directory.selections, [])
})

test('the model list has no search field and keyboard navigation selects a route directly', async t => {
  const directory = multiModelDirectory({ current: { provider: 'test-provider', model: 'swift-model', reasoningEffort: 'off' } })
  const f = fixture(t, { directory })
  f.activate()
  await renderReasoning(f)
  await openModelList(f)
  assert.equal(f.document.querySelector('input[type="search"], input[aria-label="搜索模型"]'), null)
  assert.equal(f.document.querySelectorAll('[role="option"]').length, 5, 'the complete catalog is directly available')
  assert.ok(f.document.activeElement === modelOption(f, 'Swift model'), 'the pane starts on the selected model')
  for (const [key, name] of [
    ['ArrowDown', 'Other provider model'],
    ['ArrowUp', 'Swift model'],
    ['Home', 'Test model'],
    ['End', 'Provider default model'],
  ]) {
    flushSync(() => f.document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
    assert.ok(f.document.activeElement === modelOption(f, name), `${key} moves focus to ${name}`)
  }
  assert.deepEqual(directory.selections, [], 'navigation alone never changes the model')
  const target = f.document.activeElement
  flushSync(() => {
    const uncancelled = target.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    // jsdom does not synthesize native button activation from keyboard events.
    // Model the browser's default click only when the event was not consumed.
    if (uncancelled) target.click()
  })
  await mutationsSettled()
  assert.deepEqual(directory.selections, [{ provider: 'second-provider', model: 'provider-default' }])
})

test('Escape from the model list closes the combined picker and restores the single trigger', async t => {
  const directory = multiModelDirectory()
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  const trigger = container.querySelector('button[aria-haspopup="dialog"]')
  await openModelList(f)
  const current = modelOption(f, 'Test model')
  assert.ok(f.document.activeElement === current)
  flushSync(() => current.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await mutationsSettled()
  assert.equal(f.document.querySelector('[role="dialog"][aria-label="选择模型与推理强度"]'), null)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.ok(f.document.activeElement === trigger)
  assert.deepEqual(directory.selections, [])
})

test('an unavailable saved model retains a usable chooser for selecting an available route', async t => {
  const directory = multiModelDirectory({ current: { provider: 'removed-provider', model: 'removed-model', reasoningEffort: 'max' }, routable: false })
  const f = fixture(t, { directory })
  f.activate()
  const container = await renderReasoning(f)
  assert.ok(container.querySelector('button[aria-haspopup="dialog"]'))
  assert.doesNotMatch(container.textContent, /removed-provider|removed-model|Max/)
  assert.equal(f.document.querySelector('input[aria-label="推理强度"]'), null)
  assert.ok(f.document.activeElement === modelOption(f, 'Test model'), 'an unavailable model starts on the first available choice')
  await chooseModel(f, 'Swift model')
  assert.deepEqual(directory.selections, [{ provider: 'test-provider', model: 'swift-model', reasoningEffort: 'off' }])
  assert.match(container.textContent, /Swift model/)
})

test('Tab and Shift+Tab keep keyboard focus inside both panes of the combined picker', async t => {
  const directory = multiModelDirectory()
  const f = fixture(t, { directory })
  f.activate()
  await renderReasoning(f)
  for (const pane of ['effort', 'models']) {
    if (pane === 'models') await openModelList(f)
    const dialog = select(f, '[role="dialog"][aria-label="选择模型与推理强度"]')
    const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(node => node.tabIndex >= 0)
    assert.ok(controls.length >= 2)
    const first = controls[0]
    const last = controls.at(-1)
    last.focus()
    flushSync(() => last.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    assert.ok(f.document.activeElement === first, `${pane}: Tab from the final control wraps to the first`)
    flushSync(() => first.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    assert.ok(f.document.activeElement === last, `${pane}: Shift+Tab from the first control wraps to the final one`)
  }
  assert.deepEqual(directory.selections, [], 'focus navigation never submits a model choice')
})
