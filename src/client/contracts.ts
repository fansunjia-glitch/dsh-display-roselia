import type { ComponentType } from 'react'
import type { ReasoningContext } from './reasoning-contracts'

/** Structural view of the public Cordis APIs used by this external plugin. */
export interface ClientContext extends ReasoningContext {
  effect(setup: () => (() => void), label?: string): unknown
  theme: {
    overrideTokens(source: string, tokens: ThemeTokens): () => void
  }
  slots: {
    inject(name: string, setup: () => (() => void)): unknown
    register<P extends object>(options: { name: string; priority: number }, component: ComponentType<P>): () => void
  }
}

export type ThemeTokens = Record<string, { light: string; dark: string }>

export interface MarkProps {
  size?: number
  className?: string
}
