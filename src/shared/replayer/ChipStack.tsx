const DENOMS = [
  { value: 50,   bg: '#1e1e1e', ring: '#555555' },  // black
  { value: 12.5, bg: '#1e8449', ring: '#2ecc71' },  // green
  { value: 2.5,  bg: '#c0392b', ring: '#e74c3c' },  // red
  { value: 0.5,  bg: '#c8c8c8', ring: '#999999' },  // white
]

const CHIP_SZ = 14
const CHIP_STEP = 5   // px between stacked chips

function breakdown(amountBB: number) {
  const rounded = Math.round(amountBB * 2) / 2
  let rem = rounded
  const piles: { bg: string; ring: string; count: number }[] = []
  for (const d of DENOMS) {
    const n = Math.floor(rem / d.value + 1e-9)
    rem = Math.round((rem - n * d.value) * 1000) / 1000
    if (n > 0) piles.push({ bg: d.bg, ring: d.ring, count: n })
  }
  return piles
}

function ChipPile({ bg, ring, count }: { bg: string; ring: string; count: number }) {
  const show = Math.min(count, 6)
  const height = CHIP_SZ + (show - 1) * CHIP_STEP
  return (
    <div className="flex flex-col items-center gap-0.5">
      {count > 6 && (
        <span className="text-white font-bold leading-none" style={{ fontSize: 8 }}>×{count}</span>
      )}
      <div className="relative flex-shrink-0" style={{ width: CHIP_SZ, height }}>
        {Array.from({ length: show }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: CHIP_SZ, height: CHIP_SZ,
              background: bg,
              border: `2px solid ${ring}`,
              bottom: i * CHIP_STEP,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default function ChipStack({ amountBB }: { amountBB: number }) {
  if (amountBB <= 0) return null
  const piles = breakdown(amountBB)
  if (!piles.length) return null
  return (
    <div className="flex gap-1 items-end">
      {piles.map((p, i) => <ChipPile key={i} {...p} />)}
    </div>
  )
}
