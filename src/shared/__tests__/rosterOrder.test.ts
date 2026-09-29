import { describe, expect, it } from 'vitest'
import { rosterOrder } from '../api/profilesApi'

const sorted = (names: string[], hero?: string) =>
  names.map(name => ({ name, isHero: name === hero })).sort(rosterOrder).map(p => p.name)

describe('rosterOrder', () => {
  it('keeps your own profile first', () => {
    expect(sorted(['alan', 'Zed', 'Me'], 'Me')).toEqual(['Me', 'alan', 'Zed'])
  })

  it('sorts letters A–Z ignoring case, then digits, then anything else', () => {
    expect(sorted(['🦈 shark', 'zoe', '39', 'N!CKELZ', 'Alan', '_x', 'bob', '7 @ abc']))
      .toEqual(['Alan', 'bob', 'N!CKELZ', 'zoe', '7 @ abc', '39', '_x', '🦈 shark'])
  })

  it('compares digit runs as numbers', () => {
    expect(sorted(['Player 10', 'Player 2', 'Player 1'])).toEqual(['Player 1', 'Player 2', 'Player 10'])
  })
})
