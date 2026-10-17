import type { Member } from './preferences'

/** The five existing, official Roselia character assets, without the group image. */
export const STAGE_MEMBERS = ['yukina', 'sayo', 'lisa', 'ako', 'rinko'] as const
export type StageMember = typeof STAGE_MEMBERS[number]
export type ResolvedMember = StageMember | 'all'
export const LAST_MEMBER_KEY = 'dsh-display-roselia.last-stage-member.v1'

type StageStorage = Pick<Storage, 'getItem' | 'setItem'>
interface StageOptions {
  /** Injectable randomness/storage keep the visit policy independently testable. */
  random?: () => number
  storage?: StageStorage | null
}

export interface MemberStage {
  /** Change the preference; intensity and other settings do not reroll a member. */
  update(member: Member): void
  /** Attach to the official hero brand slot from a React effect, and release on unmount. */
  mountHero(element: HTMLElement): () => void
  dispose(): void
}

function sessionStore(): StageStorage | null {
  try { return window.sessionStorage } catch { return null }
}

function isStageMember(value: unknown): value is StageMember {
  return typeof value === 'string' && STAGE_MEMBERS.includes(value as StageMember)
}

/**
 * Own the random member for one genuine home visit, independently of React renders.
 * DSH renders conversation.hero.brand.mark only in its hero shell; its public
 * content attributes distinguish blank-session navigation while that shell stays
 * mounted. The observer therefore watches two attributes on that one element,
 * never transcript mutations or the document tree. Embedded heroes are excluded.
 */
export function createMemberStage(
  onResolvedMember: (member: ResolvedMember) => void,
  options: StageOptions = {},
): MemberStage {
  const storage = options.storage === undefined ? sessionStore() : options.storage
  const random = options.random ?? Math.random
  let lastMember: StageMember | undefined
  try {
    const stored = storage?.getItem(LAST_MEMBER_KEY)
    if (isStageMember(stored)) lastMember = stored
  } catch { /* A blocked store must never block the theme. */ }

  let preference: Member | undefined
  let resolved: ResolvedMember | undefined
  let disposed = false
  let visited = false
  let heroKey: string | undefined
  let awaitingInitialBinding = false
  let mounted: { observer: MutationObserver } | undefined

  function publish(member: ResolvedMember): void {
    if (disposed || resolved === member) return
    resolved = member
    if (isStageMember(member)) {
      lastMember = member
      try { storage?.setItem(LAST_MEMBER_KEY, member) } catch { /* Best-effort no-repeat memory. */ }
    }
    onResolvedMember(member)
  }

  function choose(): void {
    const choices = STAGE_MEMBERS.filter(member => member !== lastMember)
    const sample = random()
    const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(0.9999999999999999, sample)) : 0
    publish(choices[Math.floor(normalized * choices.length)]!)
  }

  function leaveHero(): void {
    heroKey = undefined
    awaitingInitialBinding = false
  }

  return {
    update(member) {
      if (disposed || preference === member) return
      preference = member
      if (member === 'random') choose()
      else publish(member)
    },
    mountHero(element) {
      if (disposed || !element.closest('[data-slot="main.conversation"]')) return () => {}
      const content = element.closest<HTMLElement>('[data-conversation-content]')
      if (content === null) return () => {}

      mounted?.observer.disconnect()
      // A new real mount means the previous hero left the selected main panel.
      leaveHero()
      const reconcile = (): void => {
        if (disposed || mounted !== record) return
        if (content.getAttribute('data-content-phase') !== 'hero') {
          leaveHero()
          return
        }
        const key = content.getAttribute('data-conversation-session') ?? ''
        if (key === heroKey) return
        // Cold startup may render the no-session hero before its first blank
        // Session binding arrives. That is one opening, not two random draws.
        const firstBinding = awaitingInitialBinding && heroKey === '' && key !== ''
        if (!firstBinding && visited && preference === 'random') choose()
        if (resolved === undefined && preference === 'random') choose()
        awaitingInitialBinding = !visited && key === ''
        visited = true
        heroKey = key
      }
      const record = { observer: new MutationObserver(reconcile) }
      mounted = record
      record.observer.observe(content, {
        attributes: true,
        attributeFilter: ['data-content-phase', 'data-conversation-session'],
      })
      reconcile()
      let released = false
      return () => {
        if (released) return
        released = true
        record.observer.disconnect()
        if (mounted !== record) return
        mounted = undefined
        leaveHero()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      mounted?.observer.disconnect()
      mounted = undefined
      leaveHero()
    },
  }
}
