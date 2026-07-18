import type { ParsedHand } from '../types'
import ignition from './ignition'
import pokernow from './pokernow'

export interface HandParser {
  name: string
  detect(text: string): boolean
  parse(text: string): ParsedHand[]
  diagnose(text: string): string
}

// To add a new format: import it and push it onto this list.
const PARSERS: HandParser[] = [ignition, pokernow]

export function parseHandHistories(text: string): ParsedHand[] {
  for (const p of PARSERS) {
    if (p.detect(text)) return p.parse(text)
  }
  return []
}

export function diagnose(text: string): string {
  for (const p of PARSERS) {
    if (p.detect(text)) return p.diagnose(text)
  }
  return `Unrecognized format. Supported: ${PARSERS.map(p => p.name).join(', ')}.`
}
