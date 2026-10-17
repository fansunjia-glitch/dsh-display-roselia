import logo from '../../assets/official/roselia-logo.png'
import type { MarkProps } from './contracts'

/** A compact original rose glyph; the adjacent wordmark is official artwork. */
export function RoseMark({ size = 24, className }: MarkProps) {
  return <svg className={`roselia-rose ${className ?? ''}`} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 4c4-2 8 1 8 5 5 1 6 7 2 10 0 5-5 8-9 5-5 2-10-1-9-6-5-3-4-9 1-11 1-4 4-5 7-3Z" stroke="currentColor" strokeWidth="1.4" />
    <path d="M16 8c4-1 7 2 6 6 0 4-5 7-8 4-4 0-5-5-2-7 2-3 6-1 6 2 0 2-2 3-4 2M9 22c1 5 4 7 7 7-1-3-3-5-7-7Zm11 1c1 3 4 4 7 2-1-3-4-4-7-2Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function RoseliaWordmark() {
  return <span className="roselia-wordmark" title="BanG Dream! · Roselia">
    <img src={logo} alt="Roselia" draggable={false} />
  </span>
}
