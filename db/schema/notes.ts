// `notes` — one free-text note per (user, anchor). The anchor is a stable
// string built from a report/postflop selection (see src/shared/api/noteAnchor.ts),
// so a note re-attaches to the same tile across sessions.

export const CREATE_NOTES = `
  CREATE TABLE IF NOT EXISTS notes (
    user_id    text NOT NULL,
    anchor     text NOT NULL,
    body       text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, anchor)
  )
`

export const NOTES: string[] = [CREATE_NOTES]
