import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../parseHandHistory'
import { computeHandState } from '../computeHandState'
import { analyzeHand } from '../analyzeHand'
import { dedupeAndSort } from '../mergeHands'
import { rfiSpots, rfiReport, vsRfiSpots, vsRfiReport, buildReport, leakProfile } from '../reports'
import { ploCombo } from '../ploCombo'
import type { ParsedCard, HandAction, ParsedHand } from '../types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../../../')

const hh = readFileSync(resolve(root, 'hh.txt'), 'utf-8')
const hh2 = readFileSync(resolve(root, 'hh2.txt'), 'utf-8')
const hh3 = readFileSync(resolve(root, 'hh3.txt'), 'utf-8')
const hhPlo = readFileSync(resolve(root, 'hh_plo.txt'), 'utf-8')

describe('hh.txt – tournament with antes', () => {
  const hands = parseHandHistories(hh)

  test('parses all hands', () => {
    expect(hands.length).toBeGreaterThanOrEqual(2)
  })

  describe('hand #5304371621 (9-player, antes present)', () => {
    const hand = hands.find(h => h.handId === '5304371621')!

    test('found', () => expect(hand).toBeDefined())
    test('bigBlind is 25, not 5 (ante)', () => expect(hand.bigBlind).toBe(25))
    test('9 players', () => expect(hand.players.length).toBe(9))
    test('Dealer is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Dealer')
    })

    test('ME hole cards are 9s 2h', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: '9', suit: 's' },
        { rank: '2', suit: 'h' },
      ])
    })

    test('final pot is 855 (antes counted, not inflating raise math)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(855)
    })

    test('board has 5 cards: 7c 3h Qh 8s Ks', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '7', suit: 'c' },
        { rank: '3', suit: 'h' },
        { rank: 'Q', suit: 'h' },
        { rank: '8', suit: 's' },
        { rank: 'K', suit: 's' },
      ])
    })
  })

  describe('hand #5304372288 (showdown + muck)', () => {
    const hand = hands.find(h => h.handId === '5304372288')!

    test('found', () => expect(hand).toBeDefined())

    test('UTG+2 hole cards remain [3h 5h], not overwritten by 5-card showdown combo', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      const utg2 = state.players.find(p => p.position === 'UTG+2')
      expect(utg2?.holeCards).toEqual([
        { rank: '3', suit: 'h' },
        { rank: '5', suit: 'h' },
      ])
    })

    test('UTG+1 hole cards set from Mucks action [9s Qd]', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      const utg1 = state.players.find(p => p.position === 'UTG+1')
      expect(utg1?.holeCards).toEqual([
        { rank: '9', suit: 's' },
        { rank: 'Q', suit: 'd' },
      ])
    })

    test('final pot is 2463', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(2463)
    })
  })
})

describe('hh2.txt – 6-max tournament', () => {
  const hands = parseHandHistories(hh2)

  test('parses 2 hands', () => expect(hands.length).toBe(2))

  describe('hand #5304372092 (BB [ME] folds, pot 95)', () => {
    const hand = hands.find(h => h.handId === '5304372092')!

    test('found', () => expect(hand).toBeDefined())
    test('bigBlind is 25', () => expect(hand.bigBlind).toBe(25))
    test('6 players', () => expect(hand.players.length).toBe(6))
    test('Big Blind is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Big Blind')
    })

    test('ME hole cards are 8s Ad', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: '8', suit: 's' },
        { rank: 'A', suit: 'd' },
      ])
    })

    test('final pot is 95 (return_bet applied)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(95)
    })
  })

  describe('hand #5304372346 (SB [ME] all-in, loses)', () => {
    const hand = hands.find(h => h.handId === '5304372346')!

    test('found', () => expect(hand).toBeDefined())
    test('Small Blind is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Small Blind')
    })

    test('ME hole cards are Ah Jd', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: 'A', suit: 'h' },
        { rank: 'J', suit: 'd' },
      ])
    })

    test('board has 5 cards: 2h 7s Ad Qd 6s', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '2', suit: 'h' },
        { rank: '7', suit: 's' },
        { rank: 'A', suit: 'd' },
        { rank: 'Q', suit: 'd' },
        { rank: '6', suit: 's' },
      ])
    })

    test('final pot is 985', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(985)
    })
  })
})

describe('hh3.txt – cash game ($0.50/$1)', () => {
  const hands = parseHandHistories(hh3)

  test('parses at least 5 hands', () => {
    expect(hands.length).toBeGreaterThanOrEqual(5)
  })

  describe('hand #4809511473 (dead blind / straddle, 3-bet pot)', () => {
    const hand = hands.find(h => h.handId === '4809511473')!

    test('found', () => expect(hand).toBeDefined())
    test('bigBlind is 1', () => expect(hand.bigBlind).toBe(1))
    test('Dealer is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Dealer')
    })

    test('ME hole cards are Th 9s', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: 'T', suit: 'h' },
        { rank: '9', suit: 's' },
      ])
    })

    test('final pot is 59.74 (dead blind + 3-bet + multi-street)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBeCloseTo(59.74, 2)
    })

    test('board has 5 cards: 4c 2c Jd Tc 9c', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '4', suit: 'c' },
        { rank: '2', suit: 'c' },
        { rank: 'J', suit: 'd' },
        { rank: 'T', suit: 'c' },
        { rank: '9', suit: 'c' },
      ])
    })
  })

  describe('hand #4809512096 (UTG+1 [ME] folds, SB vs Dealer all-in)', () => {
    const hand = hands.find(h => h.handId === '4809512096')!

    test('found', () => expect(hand).toBeDefined())
    test('UTG+1 is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('UTG+1')
    })

    test('ME hole cards are Qs 4c', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: 'Q', suit: 's' },
        { rank: '4', suit: 'c' },
      ])
    })

    test('Small Blind hole cards are As Kh', () => {
      const state = computeHandState(hand, hand.initialStep)
      const sb = state.players.find(p => p.position === 'Small Blind')
      expect(sb?.holeCards).toEqual([
        { rank: 'A', suit: 's' },
        { rank: 'K', suit: 'h' },
      ])
    })

    test('board has 5 cards: 2s 4s Qd Ad 2d', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '2', suit: 's' },
        { rank: '4', suit: 's' },
        { rank: 'Q', suit: 'd' },
        { rank: 'A', suit: 'd' },
        { rank: '2', suit: 'd' },
      ])
    })

    test('final pot is 261.28 (multi-street, all-in)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBeCloseTo(261.28, 2)
    })
  })
})

describe('hh_plo.txt – PLO cash game ($0.10/$0.25)', () => {
  const hands = parseHandHistories(hhPlo)

  test('parses all 38 hands', () => {
    expect(hands.length).toBe(38)
  })

  test('gameType is "OMAHA Pot Limit"', () => {
    expect(hands[0].gameType).toBe('OMAHA Pot Limit')
    expect(hands[hands.length - 1].gameType).toBe('OMAHA Pot Limit')
  })

  test('bigBlind is 0.25', () => {
    expect(hands[0].bigBlind).toBe(0.25)
  })

  test('canonical metadata: site, blinds, currency, epoch playedAt', () => {
    const h = hands[0]
    expect(h.site).toBe('ignition')
    expect(h.smallBlind).toBe(0.10)
    expect(h.bigBlind).toBe(0.25)
    expect(h.currency).toBe('USD')
    // header "2026-06-24 19:21:58" is US Eastern. June → EDT (UTC-4),
    // so the true epoch is 23:21:58 UTC.
    expect(h.playedAt).toBe(Date.UTC(2026, 5, 24, 23, 21, 58))
  })

  describe('hand #4899119185 (first hand – 4 hole cards for PLO)', () => {
    const hand = hands.find(h => h.handId === '4899119185')!

    test('found', () => expect(hand).toBeDefined())
    test('Big Blind is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Big Blind')
    })
    test('ME has 4 hole cards [4c Jh Kc 5s]', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: '4', suit: 'c' },
        { rank: 'J', suit: 'h' },
        { rank: 'K', suit: 'c' },
        { rank: '5', suit: 's' },
      ])
    })
    test('4 players', () => expect(hand.players.length).toBe(4))
  })

  describe('hand #4899119603 (showdown: Dealer 4-card hole cards not overwritten by 5-card combo)', () => {
    const hand = hands.find(h => h.handId === '4899119603')!

    test('found', () => expect(hand).toBeDefined())
    test('ME is UTG+2', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('UTG+2')
    })
    test('ME hole cards are [4c 5c Ts Kc]', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: '4', suit: 'c' },
        { rank: '5', suit: 'c' },
        { rank: 'T', suit: 's' },
        { rank: 'K', suit: 'c' },
      ])
    })
    test('Dealer hole cards are [Ad 9c Th Ah], NOT the 5-card showdown combo', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      const dealer = state.players.find(p => p.position === 'Dealer')
      expect(dealer?.holeCards).toEqual([
        { rank: 'A', suit: 'd' },
        { rank: '9', suit: 'c' },
        { rank: 'T', suit: 'h' },
        { rank: 'A', suit: 'h' },
      ])
    })
    test('board is [6d 3d 8h 4s 8s]', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '6', suit: 'd' },
        { rank: '3', suit: 'd' },
        { rank: '8', suit: 'h' },
        { rank: '4', suit: 's' },
        { rank: '8', suit: 's' },
      ])
    })
  })

  describe('hand #4899121151 (showdown + muck: hole cards preserved through both)', () => {
    const hand = hands.find(h => h.handId === '4899121151')!

    test('found', () => expect(hand).toBeDefined())
    test('Small Blind 4-card hole cards [4d 6s 6h 8c] not overwritten by Showdown 5-card combo', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      const sb = state.players.find(p => p.position === 'Small Blind')
      expect(sb?.holeCards).toEqual([
        { rank: '4', suit: 'd' },
        { rank: '6', suit: 's' },
        { rank: '6', suit: 'h' },
        { rank: '8', suit: 'c' },
      ])
    })
    test('Big Blind hole cards [3h Ah 6c Qd] set from Mucks action', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      const bb = state.players.find(p => p.position === 'Big Blind')
      expect(bb?.holeCards).toEqual([
        { rank: '3', suit: 'h' },
        { rank: 'A', suit: 'h' },
        { rank: '6', suit: 'c' },
        { rank: 'Q', suit: 'd' },
      ])
    })
    test('board is [3s 8s 8d Ad 5c]', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '3', suit: 's' },
        { rank: '8', suit: 's' },
        { rank: '8', suit: 'd' },
        { rank: 'A', suit: 'd' },
        { rank: '5', suit: 'c' },
      ])
    })
  })

  describe('hand #4899120599 (multi-street, all-in river, return_bet)', () => {
    const hand = hands.find(h => h.handId === '4899120599')!

    test('found', () => expect(hand).toBeDefined())
    test('ME is Small Blind', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Small Blind')
    })
    test('board is [Qc 6h Jh 5h 7d]', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: 'Q', suit: 'c' },
        { rank: '6', suit: 'h' },
        { rank: 'J', suit: 'h' },
        { rank: '5', suit: 'h' },
        { rank: '7', suit: 'd' },
      ])
    })
    test('final pot is 27.10 (multi-street + all-in + return_bet applied)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBeCloseTo(27.10, 2)
    })
    test('Big Blind hole cards [Th 8s 9h 6s]', () => {
      const state = computeHandState(hand, hand.initialStep)
      const bb = state.players.find(p => p.position === 'Big Blind')
      expect(bb?.holeCards).toEqual([
        { rank: 'T', suit: 'h' },
        { rank: '8', suit: 's' },
        { rank: '9', suit: 'h' },
        { rank: '6', suit: 's' },
      ])
    })
  })
})

describe('dedupeAndSort – multi-file import merging', () => {
  const single = parseHandHistories(hhPlo)

  test('drops duplicate hand ids when the same file is imported twice', () => {
    const doubled = parseHandHistories(hhPlo + '\n\n' + hhPlo)
    expect(doubled.length).toBe(single.length * 2)        // raw parse has dupes
    expect(dedupeAndSort(doubled).length).toBe(single.length) // merged removes them
  })

  test('orders merged hands chronologically by playedAt', () => {
    const merged = dedupeAndSort(parseHandHistories(hhPlo))
    const times = merged.map(h => h.playedAt ?? Infinity)
    const sorted = [...times].sort((a, b) => a - b)
    expect(times).toEqual(sorted)
  })

  test('mixing stakes/games is preserved per-hand (no global conflict)', () => {
    // every hand keeps its own blinds/gameType after merging
    const merged = dedupeAndSort(parseHandHistories(hhPlo))
    expect(merged.every(h => h.bigBlind === 0.25 && h.gameType === 'OMAHA Pot Limit')).toBe(true)
  })
})

describe('RFI reports (population, by position)', () => {
  const hands = parseHandHistories(hhPlo)
  const get = (id: string) => hands.find(h => h.handId === id)!

  test('#4899119287: folded to villain Button who raises → BU RFI raise spot', () => {
    // UTG & UTG+1 fold, Dealer (villain) opens; SB[ME]/BB are after the open
    const spots = rfiSpots(get('4899119287'))
    const bu = spots.find(s => s.displayPos === 'BU')
    expect(bu).toBeDefined()
    expect(bu!.action).toBe('raise')
    expect(bu!.isHero).toBe(false)
    expect(bu!.stackBB).toBeGreaterThanOrEqual(75)
    // the two players before the open are folds in unopened pots
    expect(spots.filter(s => s.action === 'fold').length).toBe(2)
  })

  test('facing a raise is NOT an RFI spot (#4899119185: Dealer folds to an open)', () => {
    // UTG opens first, so Dealer never faced an unopened pot
    const spots = rfiSpots(get('4899119185'))
    expect(spots.some(s => s.displayPos === 'BU')).toBe(false)
  })

  test('rfiReport aggregates BU raises and excludes the hero', () => {
    // #4899119287 = villain BU open (counts); #4899120324 = hero BU open (excluded)
    const sample = [get('4899119287'), get('4899120324')]
    const pop = rfiReport(sample, { position: 'BU', minBB: 75, excludeHero: true })
    expect(pop.counts.raise).toBe(1)
    expect(pop.total).toBe(1)
    expect(pop.pct.raise).toBe(100)

    // including hero, both BU opens count
    const all = rfiReport(sample, { position: 'BU', minBB: 75, excludeHero: false })
    expect(all.counts.raise).toBe(2)
  })

  test('75bb+ filter drops short stacks', () => {
    const sample = [get('4899119287')] // Dealer ~136bb
    expect(rfiReport(sample, { position: 'BU', minBB: 75, excludeHero: true }).total).toBe(1)
    expect(rfiReport(sample, { position: 'BU', minBB: 200, excludeHero: true }).total).toBe(0)
  })

  // ---- vs-RFI ----
  test('vsRfiSpots: BB calls a pure Button RFI', () => {
    // #4899119287: BU opens 3.4bb, SB[ME] folds, BB calls → both are vs-RFI spots
    const spots = vsRfiSpots(get('4899119287'))
    const bb = spots.find(s => s.defenderPos === 'BB')
    expect(bb).toBeDefined()
    expect(bb!.openerPos).toBe('BU')
    expect(bb!.action).toBe('call')
  })

  test('vsRfiReport BB vs BU counts the call', () => {
    const r = vsRfiReport([get('4899119287')], { defender: 'BB', opener: 'BU', minBB: 75, excludeHero: true })
    expect(r.counts.call).toBe(1)
    expect(r.total).toBe(1)
  })

  test('a cold-call in front ends the pure-RFI chain (later folders not counted)', () => {
    // #4899119835: CO opens, BU cold-calls → only BU is a vs-RFI spot; SB/BB folds after don't count
    const spots = vsRfiSpots(get('4899119835'))
    expect(spots.length).toBe(1)
    expect(spots[0].defenderPos).toBe('BU')
    expect(spots[0].openerPos).toBe('CO')
    expect(spots[0].action).toBe('call')
  })

  test('opens below the RFI size threshold are excluded', () => {
    // #4899119287 open is 3.4bb; requiring >=5bb yields no vs-RFI spots
    expect(vsRfiSpots(get('4899119287'), 5.0).length).toBe(0)
  })

  test('vs-RFI requires BOTH players 75bb+ (short opener excluded)', () => {
    // synthetic 3-handed: BU opens 3bb but is only 50bb deep; BB defends 100bb
    const mkAction = (type: string, seatNumber: number, amount?: number): HandAction =>
      ({ type: type as HandAction['type'], seatNumber, amount, street: 'preflop', desc: '' })
    const hand = {
      handId: 'synthetic', tableId: '', site: 'ignition', date: '', playedAt: 0,
      gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
      players: [
        { seatNumber: 1, position: 'Dealer', isMe: false, startingStack: 50 },   // BU, short opener
        { seatNumber: 2, position: 'Small Blind', isMe: false, startingStack: 100 },
        { seatNumber: 3, position: 'Big Blind', isMe: false, startingStack: 100 },
      ],
      actions: [
        mkAction('raise', 1, 3), // BU opens to 3bb
        mkAction('fold', 2),     // SB folds
        mkAction('call', 3, 2),  // BB calls
      ],
    } as ParsedHand
    const spots = vsRfiSpots(hand)
    const bb = spots.find(s => s.defenderPos === 'BB')!
    expect(bb.openerStackBB).toBe(50)
    // defender is 100bb but opener is only 50bb → excluded at 75bb+
    expect(vsRfiReport([hand], { defender: 'BB', opener: 'BU', minBB: 75, excludeHero: true }).total).toBe(0)
    // lower the threshold and it counts
    expect(vsRfiReport([hand], { defender: 'BB', opener: 'BU', minBB: 40, excludeHero: true }).total).toBe(1)
  })
})

describe('ploCombo – dealt hand → solver combo key', () => {
  const C = (s: string): ParsedCard[] =>
    s.split(' ').map(t => ({ rank: t.slice(0, -1), suit: t.slice(-1) as ParsedCard['suit'] }))

  test('user-confirmed mappings', () => {
    expect(ploCombo(C('As 2s Ah Ad'))).toBe('[A2]AA')   // A2 suited, other aces offsuit
    expect(ploCombo(C('Js Ts 9h 8h'))).toBe('[JT][98]') // double-suited JT / 98
    expect(ploCombo(C('As Ah Ad Ac'))).toBe('AAAA')      // rainbow quads
    expect(ploCombo(C('Ah 4h 3h 2h'))).toBe('[A432]')    // monotone
  })

  test('every parsed PLO hole hand maps to a real solver combo (BU table)', () => {
    const table = JSON.parse(readFileSync(resolve(root, 'public/solver/rfi/bu.json'), 'utf-8'))
    const hands = parseHandHistories(hhPlo)
    let checked = 0
    for (const h of hands) {
      for (const a of h.actions) {
        if (a.type === 'deal_hole' && a.cards?.length === 4) {
          expect(table[ploCombo(a.cards)]).toBeDefined()
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  test('leakProfile maps the two axes to archetypes', () => {
    expect(leakProfile({ tight: 0, loose: 1, passive: 1, aggressive: 0 })).toMatchObject({ label: 'Loose-Passive', nickname: 'station' })
    expect(leakProfile({ tight: 1, loose: 0, passive: 1, aggressive: 0 })).toMatchObject({ label: 'Tight-Passive', nickname: 'nit' })
    expect(leakProfile({ tight: 0, loose: 1, passive: 0, aggressive: 1 })).toMatchObject({ label: 'Loose-Aggressive', nickname: 'maniac' })
    expect(leakProfile({ tight: 0, loose: 0, passive: 0, aggressive: 0 }).label).toBe('≈ GTO')
    expect(leakProfile({ tight: 0, loose: 1, passive: 0, aggressive: 0 }).label).toBe('Loose') // one-sided
  })

  test('raise→fold counts on BOTH axes (loose + aggressive)', () => {
    const C = (s: string): ParsedCard[] =>
      s.split(' ').map(t => ({ rank: t.slice(0, -1), suit: t.slice(-1) as ParsedCard['suit'] }))
    const bbCards = C('Ah Kh Qd Jc')
    const combo = ploCombo(bbCards)
    const table = { [combo]: [0, -0.5, -1.0] } // fold best; call -0.5; 3bet -1.0
    const mk = (type: string, seatNumber: number, amount?: number, cards?: ParsedCard[]): HandAction =>
      ({ type: type as HandAction['type'], seatNumber, amount, cards, street: 'preflop', desc: '' })
    const hand = {
      handId: 'syn2', tableId: '', site: 'ignition', date: '', playedAt: 0,
      gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
      players: [
        { seatNumber: 1, position: 'Dealer', isMe: false, startingStack: 100 },
        { seatNumber: 2, position: 'Small Blind', isMe: false, startingStack: 100 },
        { seatNumber: 3, position: 'Big Blind', isMe: false, startingStack: 100 },
      ],
      actions: [
        mk('deal_hole', 3, undefined, bbCards),
        mk('raise', 1, 3),  // BU opens (RFI)
        mk('fold', 2),      // SB folds
        mk('raise', 3, 9),  // BB 3-bets a hand that should fold
      ],
    } as ParsedHand
    const r = buildReport([hand], { type: 'vsrfi', defender: 'BB', opener: 'BU' }, table)
    expect(r.ev!.axes.loose).toBeCloseTo(1.0, 5)
    expect(r.ev!.axes.aggressive).toBeCloseTo(1.0, 5)
    expect(r.ev!.axes.tight).toBe(0)
    expect(r.ev!.axes.passive).toBe(0)
  })

  test('buildReport computes GTO EV loss end-to-end (BU RFI)', () => {
    const table = JSON.parse(readFileSync(resolve(root, 'public/solver/rfi/bu.json'), 'utf-8'))
    const hands = parseHandHistories(hhPlo)
    const r = buildReport(hands, { type: 'rfi', pos: 'BU' }, table)
    expect(r.ev).toBeDefined()
    expect(r.ev!.spots).toBeGreaterThan(0)
    expect(r.ev!.perSpotBb).toBeGreaterThanOrEqual(0)
    expect(r.ev!.perSpotBb).toBeLessThan(2) // sanity: population isn't bleeding >2bb/spot
    // EV loss is attached to individual hands
    expect(r.buckets.flatMap(b => b.entries).some(e => e.evLossBb !== undefined)).toBe(true)
  })
})

describe('analyzeHand – flop c-bet & multiway spots (PLO data)', () => {
  const hands = parseHandHistories(hhPlo)
  const byId = (id: string) => analyzeHand(hands.find(h => h.handId === id)!)

  test('#4899120324: hero is PFR, c-bets flop IP (checked to)', () => {
    const a = byId('4899120324')
    expect(a.potType).toBe('srp')
    expect(a.heroIsPfr).toBe(true)
    expect(a.heroFlopCbetOpportunity).toBe(true)
    expect(a.heroFlopCbet).toBe(true)
    expect(a.flopCbet?.inPosition).toBe(true)
    expect(a.multiwayPostflop).toBe(false)
  })

  test('#4899120986: hero is PFR, c-bets flop OOP (first to act)', () => {
    const a = byId('4899120986')
    expect(a.heroIsPfr).toBe(true)
    expect(a.heroFlopCbet).toBe(true)
    expect(a.flopCbet?.inPosition).toBe(false)
  })

  test('#4899121341: hero is PFR, has opportunity but checks back (no c-bet)', () => {
    const a = byId('4899121341')
    expect(a.heroIsPfr).toBe(true)
    expect(a.heroFlopCbetOpportunity).toBe(true)
    expect(a.heroFlopCbet).toBe(false)
  })

  test('#4899119287: villain is PFR, hero folded preflop', () => {
    const a = byId('4899119287')
    expect(a.heroIsPfr).toBe(false)
    expect(a.heroFlopCbetOpportunity).toBe(false)
    expect(a.pfrSeat).toBe(1) // Dealer
    expect(a.flopCbet?.opportunity).toBe(true) // the Dealer (PFR) had the opp
    expect(a.flopCbet?.took).toBe(false)       // …and checked back
  })

  test('heroVpip: true when hero raises, false when hero only posts blind & folds', () => {
    expect(byId('4899120324').heroVpip).toBe(true)   // hero (Dealer) raises preflop
    expect(byId('4899119185').heroVpip).toBe(false)  // hero (BB) posts blind, folds
    expect(byId('4899119287').heroVpip).toBe(false)  // hero (SB) posts blind, folds
  })

  test('walk / unraised pots have no PFR and no flop c-bet', () => {
    const a = byId('4899120263') // folds around, BB wins, no flop
    expect(a.pfrSeat).toBe(null)
    expect(a.flopCbet).toBe(null)
  })
})
