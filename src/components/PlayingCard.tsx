import type { ParsedCard } from '../lib/types'

const SUIT_SYMBOL: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' }

// 4-color deck backgrounds
const SUIT_BG: Record<string, string> = {
  h: '#c0392b',
  d: '#2471a3',
  c: '#1e8449',
  s: '#212121',
}

interface Props {
  card: ParsedCard
  medium?: boolean
  small?: boolean
  tiny?: boolean
}

export default function PlayingCard({ card, medium, small, tiny }: Props) {
  const sym = SUIT_SYMBOL[card.suit]
  const bg = SUIT_BG[card.suit]
  const w = tiny ? 22 : small ? 30 : medium ? 45 : 40
  const h = tiny ? 30 : small ? 42 : medium ? 63 : 56
  const rankSize = tiny ? 12 : small ? 17 : medium ? 25 : 26
  const suitSize = tiny ? 7 : small ? 10 : medium ? 11 : 13

  return (
    <div
      className="rounded shadow-md select-none relative flex items-center justify-center"
      style={{ width: w, height: h, background: bg, boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.22)' }}
    >
      {/* suit + rank in top-left */}
      <div
        className="absolute top-0 left-0 flex flex-col items-center leading-none"
        style={{ padding: small ? '2px 3px' : '3px 4px', gap: 1 }}
      >
        <span style={{ fontSize: suitSize, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>{sym}</span>
      </div>
      {/* big rank in center */}
      <span style={{ fontSize: rankSize, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
        {card.rank}
      </span>
    </div>
  )
}

export function FaceDownCard({ medium, small }: { medium?: boolean; small?: boolean }) {
  const w = small ? 30 : medium ? 45 : 40
  const h = small ? 42 : medium ? 63 : 56
  return (
    <div
      className="rounded shadow-md border border-blue-700"
      style={{
        width: w, height: h,
        background: 'repeating-linear-gradient(45deg, #1e3a5f 0px, #1e3a5f 2px, #1a3356 2px, #1a3356 8px)',
        boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.18)',
      }}
    />
  )
}
