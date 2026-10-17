export const STORAGE_KEY = 'dsh-display-roselia.preferences.v1'
export type Scene = 'stage' | 'nocturne' | 'live' | 'quiet'
export const MEMBER_IDS = ['random', 'all', 'yukina', 'sayo', 'lisa', 'ako', 'rinko'] as const
export type Member = typeof MEMBER_IDS[number]
export interface Preferences { scene: Scene; intensity: number; artwork: boolean; member: Member }
export const DEFAULTS: Readonly<Preferences> = Object.freeze({ scene: 'stage', intensity: 75, artwork: true, member: 'random' })

/** Local display preferences never change DSH's own light/dark or font settings. */
export function readPreferences(storage: Storage): Preferences {
  try {
    const raw: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
    const value = raw as Record<string, unknown>
    // Upgrade only the untouched v1 design; keep deliberate scenes and members.
    if (value.version === undefined && value.scene === 'nocturne' && value.intensity === 65 && value.artwork === true && value.member === 'all') {
      return { ...DEFAULTS }
    }
    return {
      scene: value.scene === 'stage' || value.scene === 'nocturne' || value.scene === 'live' || value.scene === 'quiet' ? value.scene : DEFAULTS.scene,
      intensity: typeof value.intensity === 'number' && Number.isFinite(value.intensity)
        ? Math.max(0, Math.min(100, Math.round(value.intensity))) : DEFAULTS.intensity,
      artwork: typeof value.artwork === 'boolean' ? value.artwork : DEFAULTS.artwork,
      member: MEMBER_IDS.includes(value.member as Member) ? value.member as Member : DEFAULTS.member,
    }
  } catch {
    // A restricted or corrupt local store must not prevent the theme from loading.
    return { ...DEFAULTS }
  }
}
