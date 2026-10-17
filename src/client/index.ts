import { createElement, useEffect, useRef } from 'react'
import type { ClientContext, MarkProps } from './contracts'
import { tokens } from './palette'
import { RoseMark, RoseliaWordmark } from './brand'
import { installControls } from './controls'
import { wallpaper, band, members } from './artwork'
import css from './theme.css?inline'
import { registerReasoningSlider } from './reasoning'
import { createMemberStage } from './member-stage'

export const name = 'display-roselia-nocturne'
export const inject = ['theme', 'slots']
const ID = 'dsh-display-roselia'

/** Register only reversible theme and brand contributions; no Host mutations. */
export function apply(ctx: ClientContext): void {
  registerReasoningSlider(ctx)
  ctx.effect(() => ctx.theme.overrideTokens(ID, tokens), 'Roselia semantic palette')
  ctx.effect(() => {
    // Chromium limits a single CSS custom-property value to about 1 MiB.
    // Keep the high-resolution offline wallpaper out of that token stream.
    const bytes = Uint8Array.from(atob(wallpaper.slice(wallpaper.indexOf(',') + 1)), char => char.charCodeAt(0))
    const wallpaperUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    const style = document.createElement('style')
    style.dataset.plugin = ID
    style.dataset.pluginCss = `${ID}/theme.css`
    style.textContent = css.replaceAll('ROSELIA_WALLPAPER', wallpaperUrl).replaceAll('ROSELIA_LIVE', band)
    document.head.append(style)
    const body = document.body
    const attributes = ['data-roselia-display', 'data-roselia-scene', 'data-roselia-artwork', 'data-roselia-member', 'data-roselia-member-preference']
    const previousAttributes = attributes.map(key => [key, body.getAttribute(key)] as const)
    const variables = ['--roselia-strength', '--roselia-member-image']
    const previousVariables = variables.map(key => [key, body.style.getPropertyValue(key), body.style.getPropertyPriority(key)] as const)
    body.setAttribute('data-roselia-display', '')
    const stage = createMemberStage(memberId => {
      body.setAttribute('data-roselia-member', memberId)
      const member = members.find(item => item.id === memberId)!
      body.style.setProperty('--roselia-member-image', `url("${member.image}")`)
    })
    const disposeControls = installControls(preferences => {
      body.setAttribute('data-roselia-scene', preferences.scene)
      body.setAttribute('data-roselia-artwork', String(preferences.artwork))
      body.setAttribute('data-roselia-member-preference', preferences.member)
      body.style.setProperty('--roselia-strength', String(preferences.intensity / 100))
      stage.update(preferences.member)
    })
    function HeroMark(props: MarkProps) {
      const ref = useRef<HTMLSpanElement>(null)
      useEffect(() => ref.current === null ? undefined : stage.mountHero(ref.current), [])
      return createElement('span', { className: 'roselia-hero-mark', ref }, createElement(RoseMark, props))
    }
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, HeroMark))
    return () => {
      stage.dispose()
      disposeControls()
      style.remove()
      URL.revokeObjectURL(wallpaperUrl)
      for (const [key, value] of previousAttributes) {
        if (value === null) body.removeAttribute(key)
        else body.setAttribute(key, value)
      }
      for (const [key, value, priority] of previousVariables) {
        if (value === '') body.style.removeProperty(key)
        else body.style.setProperty(key, value, priority)
      }
    }
  }, 'Roselia styles and local controls')
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, RoseMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, RoseliaWordmark))
}
