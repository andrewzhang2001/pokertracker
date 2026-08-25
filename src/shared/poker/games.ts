// PLO vs NLHE — a top-level dimension parallel to table_kind (6-max/HU). Derived
// from the parsed game type (Ignition headers say "OMAHA …" or "HOLDEM …"), the
// same signal the Hold'em report filter uses.
export type GameKind = 'plo' | 'nlhe'
export const gameKind = (gameType: string): GameKind => (/holdem/i.test(gameType) ? 'nlhe' : 'plo')

// ---------------------------------------------------------------------------
// Per-game config — the single place to tune anything that differs by game, so
// adding a game or a knob is one edit here instead of constants littered through
// the extractors. Add fields as more game-specific behavior appears.
// ---------------------------------------------------------------------------

// Preflop sizing gates (bb): the minimum raise sizes that qualify a raise as a
// real RFI open / 3-bet / iso (for the vs-RFI / vs-3-bet chains and limp-iso).
// Blinds open & 3-bet smaller — the SB, and the HU button which normalizes to SB
// — so they get a looser floor. NLHE runs far smaller than PLO (min-opens down to
// 2bb, 3-bets from ~6bb), so the PLO 3bb/10bb gates would drop most NLHE spots.
export interface GameSizing {
  open: number          // an open ≥ this counts as an RFI
  blindOpen: number     // looser floor when a blind (SB / HU button) opens
  threebet: number      // a re-raise ≥ this counts as a real 3-bet
  blindThreebet: number
  iso: number           // an iso raise ≥ this over the limps
}

export interface GameConfig {
  label: string
  hasSolver: boolean    // PLO ships GTO ranges; NLHE is frequency-only (no EV)
  sizing: GameSizing
}

export const GAMES: Record<GameKind, GameConfig> = {
  plo:  { label: 'PLO',  hasSolver: true,  sizing: { open: 3.0, blindOpen: 2.6, threebet: 10.0, blindThreebet: 7.5, iso: 3.0 } },
  nlhe: { label: 'NLHE', hasSolver: false, sizing: { open: 2.0, blindOpen: 2.0, threebet: 6.0,  blindThreebet: 6.0, iso: 2.0 } },
}
