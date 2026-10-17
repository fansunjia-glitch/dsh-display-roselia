import type { ComponentType } from 'react'

/** Structural copies of the public DSH 0.2.1-rc.2 model-directory and slot faces. */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ReasoningMetadata {
  efforts: readonly { id: string; name: string }[]
  defaultEffort?: string
}

export interface ModelDirectoryState {
  current: ModelSelection | null
  routable: boolean | null
  groups: readonly {
    id: string
    name?: string
    models: readonly { id: string; name: string; reasoning?: ReasoningMetadata }[]
  }[]
  failures?: readonly { id: string; name: string; message: string }[]
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  pending: ModelSelection | null
  error: string | null
}

export interface DirectoryStore {
  getSnapshot(): ModelDirectoryState
  subscribe(listener: () => void): () => void
}

export type SelectionResult = { ok: true } | { ok: false; error: { code: string; message: string } }

export interface ReasoningInjected {
  available: boolean
  directory: DirectoryStore | null
  load(): Promise<unknown>
  select(selection: ModelSelection): Promise<SelectionResult | undefined>
}

export interface ReasoningSlotProps extends ReasoningInjected {
  /** Public model-seat owner plus session-standard identity. */
  sessionId: string
  locked: boolean
}

interface ReasoningScope {
  modelDirectories: {
    directoryFor(sessionId: string): {
      store: DirectoryStore
      load(): Promise<unknown>
      select(selection: ModelSelection): Promise<SelectionResult>
    }
  }
  sessions: { subagentAddress(sessionId: string): unknown | undefined }
  slots: {
    inject(name: string, setup: () => (() => void)): unknown
    register(options: {
      name: string
      priority: number
      inject(sessionId: string): ReasoningInjected
    }, component: ComponentType<ReasoningSlotProps>): () => void
  }
}

export interface ReasoningContext {
  effect(setup: () => (() => void), label?: string): unknown
  /** Cordis optional service scope: palette remains usable without the model UI. */
  inject(services: string[], setup: (scope: ReasoningScope) => void): unknown
}
