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
  small?: boolean
}

export default function PlayingCard({ card, small }: Props) {
  const sym = SUIT_SYMBOL[card.suit]
  const bg = SUIT_BG[card.suit]
  const w = small ? 30 : 40
  const h = small ? 42 : 56
  const rankSize = small ? 15 : 22
  const suitSize = small ? 8 : 11

  return (
    <div
      className="rounded shadow-md select-none relative flex items-center justify-center"
      style={{ width: w, height: h, background: bg }}
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

export function FaceDownCard({ small }: { small?: boolean }) {
  const w = small ? 30 : 40
  const h = small ? 42 : 56
  return (
    <div
      className="rounded shadow-md border border-blue-700"
      style={{
        width: w, height: h,
        background: 'repeating-linear-gradient(45deg, #1e3a5f 0px, #1e3a5f 2px, #1a3356 2px, #1a3356 8px)',
      }}
    />
  )
}
