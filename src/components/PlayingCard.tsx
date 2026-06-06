import type { ParsedCard } from '../lib/types'

const SUIT_SYMBOL: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' }
// 4-color deck: hearts=red, diamonds=blue, clubs=green, spades=black
const SUIT_COLOR: Record<string, string> = {
  h: '#e53e3e',
  d: '#3182ce',
  c: '#38a169',
  s: '#1a202c',
}

interface Props {
  card: ParsedCard
  small?: boolean
}

export default function PlayingCard({ card, small }: Props) {
  const sym = SUIT_SYMBOL[card.suit]
  const color = SUIT_COLOR[card.suit]
  const w = small ? 28 : 36
  const h = small ? 40 : 52
  const rankSize = small ? 11 : 13
  const suitSize = small ? 14 : 18

  return (
    <div
      className="bg-white rounded shadow-md flex flex-col items-center justify-between select-none"
      style={{ width: w, height: h, padding: 2 }}
    >
      <span style={{ fontSize: rankSize, fontWeight: 700, color, lineHeight: 1, alignSelf: 'flex-start' }}>
        {card.rank}
      </span>
      <span style={{ fontSize: suitSize, fontWeight: 700, color, lineHeight: 1 }}>
        {sym}
      </span>
      <span style={{ fontSize: rankSize, fontWeight: 700, color, lineHeight: 1, alignSelf: 'flex-end', transform: 'rotate(180deg)' }}>
        {card.rank}
      </span>
    </div>
  )
}

export function FaceDownCard({ small }: { small?: boolean }) {
  const w = small ? 28 : 36
  const h = small ? 40 : 52
  return (
    <div
      className="rounded shadow-md border border-blue-600"
      style={{
        width: w, height: h,
        background: 'repeating-linear-gradient(45deg, #1e3a5f 0px, #1e3a5f 2px, #1a3356 2px, #1a3356 8px)',
      }}
    />
  )
}
