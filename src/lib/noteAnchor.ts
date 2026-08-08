import type { GameKind } from './games'
import type { TableKind } from './positionUtils'
import type { ReportSel, Subject } from './reports'

// The single source of truth for note anchor keys. A note is attached to a
// SEMANTIC page identity, not a URL or filter set: the same anchor is produced
// regardless of the active month range, vpip filter, board texture, bet size, or
// hero/population subject. That's deliberate — you write one high-level read per
// spot ("BB vs IP c-bet") and it surfaces under every filter, informing the
// decision rather than fragmenting into a note per size/texture.
//
// `game` (plo/nlhe) IS part of the identity — the two games are strategically
// distinct, so a note never leaks across them. Table kind (6max/hu) is part of
// the identity too: for reports it's an explicit segment; for postflop it's
// already baked into the formationId.

// Report / leakbuster identity. selKey mirrors ReportsView's own selKey so the
// menu and the note panel agree on what "this report" is. Subject IS part of the
// key: Reports (population) and Leakbuster (your hands) are the same spot but
// different lenses — population tendencies vs your own leaks — so their notes
// stay separate.
function selKey(sel: ReportSel): string {
  return sel.type === 'rfi' ? `rfi:${sel.pos}`
    : sel.type === 'vsrfi' ? `vsrfi:${sel.defender}:${sel.opener}`
    : sel.type === 'vs3bet' ? `vs3bet:${sel.opener}:${sel.tag}`
    : `limpiso:${sel.iso}`
}

export function reportAnchor(game: GameKind, kind: TableKind, subject: Subject, sel: ReportSel): string {
  return `report:${subject}:${game}:${kind}:${selKey(sel)}`
}

// Postflop node identity. formationId already encodes pot type, position roles,
// and table kind, so game + formation + node fully identify the decision.
export function postflopAnchor(game: GameKind, formationId: string, nodeId: string): string {
  return `postflop:${game}:${formationId}:${nodeId}`
}
