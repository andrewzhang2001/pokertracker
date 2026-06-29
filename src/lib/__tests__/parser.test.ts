import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../parseHandHistory'
import { computeHandState } from '../computeHandState'
import { analyzeHand } from '../analyzeHand'
import { dedupeAndSort } from '../mergeHands'
import { rfiSpots, rfiReport, vsRfiSpots, vsRfiReport, vs3betSpots, vs3betReport, limpVsIsoSpots, limpVsIsoReport, buildReport, leakProfile } from '../reports'
import { ploCombo } from '../ploCombo'
import { flopTexture, straightPossibleFlop, straightPossibleBoard, boardPaired, boardSuits, extractFlopSpot, extractSpots, formationReport, EMPTY_FILTER } from '../postflop'
import { classifyFlop, classifyBoard } from '../ploEval'
import { showdownEquities } from '../equity'
import { handStat } from '../graph'
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
    const pop = rfiReport(sample, { position: 'BU', minBB: 75, subject: 'population' })
    expect(pop.counts.raise).toBe(1)
    expect(pop.total).toBe(1)
    expect(pop.pct.raise).toBe(100)

    // including hero, both BU opens count
    const all = rfiReport(sample, { position: 'BU', minBB: 75, subject: 'all' })
    expect(all.counts.raise).toBe(2)
  })

  test('75bb+ filter drops short stacks', () => {
    const sample = [get('4899119287')] // Dealer ~136bb
    expect(rfiReport(sample, { position: 'BU', minBB: 75, subject: 'population' }).total).toBe(1)
    expect(rfiReport(sample, { position: 'BU', minBB: 200, subject: 'population' }).total).toBe(0)
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
    const r = vsRfiReport([get('4899119287')], { defender: 'BB', opener: 'BU', minBB: 75, subject: 'population' })
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
    expect(vsRfiReport([hand], { defender: 'BB', opener: 'BU', minBB: 75, subject: 'population' }).total).toBe(0)
    // lower the threshold and it counts
    expect(vsRfiReport([hand], { defender: 'BB', opener: 'BU', minBB: 40, subject: 'population' }).total).toBe(1)
  })

  // ---- vs-3-bet ----
  // 6-max synthetic: UTG=LJ, UTG+1=HJ, UTG+2=CO, Dealer=BU, plus SB/BB.
  const mk6 = (acts: [string, number, number?][], stacks: Partial<Record<number, number>> = {}): ParsedHand => ({
    handId: 's3b', tableId: '', site: 'ignition', date: '', playedAt: 0,
    gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
    players: [
      { seatNumber: 1, position: 'UTG', isMe: false, startingStack: stacks[1] ?? 100 },     // LJ
      { seatNumber: 2, position: 'UTG+1', isMe: false, startingStack: stacks[2] ?? 100 },   // HJ
      { seatNumber: 3, position: 'UTG+2', isMe: false, startingStack: stacks[3] ?? 100 },   // CO
      { seatNumber: 4, position: 'Dealer', isMe: false, startingStack: stacks[4] ?? 100 },  // BU
      { seatNumber: 5, position: 'Small Blind', isMe: false, startingStack: stacks[5] ?? 100 },
      { seatNumber: 6, position: 'Big Blind', isMe: false, startingStack: stacks[6] ?? 100 },
    ],
    actions: acts.map(([type, seatNumber, amount]) =>
      ({ type: type as HandAction['type'], seatNumber, amount, street: 'preflop', desc: '' })),
  } as ParsedHand)

  test('vs3betSpots: LJ opens, BU 3-bets (IP), LJ calls', () => {
    const h = mk6([
      ['raise', 1, 3.5], ['fold', 2], ['fold', 3], ['raise', 4, 12], ['fold', 5], ['fold', 6], ['call', 1, 8.5],
    ])
    const spots = vs3betSpots(h)
    expect(spots.length).toBe(1)
    expect(spots[0]).toMatchObject({ openerPos: 'LJ', threeBettorPos: 'BU', tag: 'ip', action: 'call' })
  })

  test('vs3betSpots: LJ opens, SB 3-bets (OOP), LJ folds', () => {
    const h = mk6([['raise', 1, 3.5], ['fold', 2], ['fold', 3], ['fold', 4], ['raise', 5, 12], ['fold', 6], ['fold', 1]])
    const spots = vs3betSpots(h)
    expect(spots[0]).toMatchObject({ openerPos: 'LJ', threeBettorPos: 'SB', tag: 'oop', action: 'fold' })
  })

  test('vs3betSpots: SB opens, BB 3-bets → tag bb', () => {
    const h = mk6([['fold', 1], ['fold', 2], ['fold', 3], ['fold', 4], ['raise', 5, 3.5], ['raise', 6, 12], ['raise', 5, 30]])
    const spots = vs3betSpots(h)
    expect(spots[0]).toMatchObject({ openerPos: 'SB', threeBettorPos: 'BB', tag: 'bb', action: 'raise' })
  })

  test('vs3betSpots: a flat before the 3-bet (squeeze pot) is excluded', () => {
    const h = mk6([['raise', 1, 3.5], ['call', 3, 3.5], ['raise', 4, 14], ['fold', 5], ['fold', 6], ['fold', 1], ['fold', 3]])
    expect(vs3betSpots(h).length).toBe(0)
  })

  test('vs3betSpots: a cold-call of the 3-bet (3rd seat in) is excluded', () => {
    const h = mk6([['raise', 1, 3.5], ['fold', 2], ['fold', 3], ['raise', 4, 12], ['call', 5, 12], ['fold', 6], ['fold', 1]])
    expect(vs3betSpots(h).length).toBe(0)
  })

  test('vs3betSpots: a sub-10bb 3-bet is excluded', () => {
    const h = mk6([['raise', 1, 3.5], ['fold', 2], ['fold', 3], ['raise', 4, 8], ['fold', 5], ['fold', 6], ['fold', 1]])
    expect(vs3betSpots(h).length).toBe(0)
  })

  test('vs3betReport requires BOTH opener & 3-bettor 75bb+', () => {
    const h = mk6([['raise', 1, 3.5], ['fold', 2], ['fold', 3], ['raise', 4, 12], ['fold', 5], ['fold', 6], ['call', 1, 8.5]], { 4: 50 })
    expect(vs3betReport([h], { opener: 'LJ', tag: 'ip', minBB: 75, subject: 'population' }).total).toBe(0)
    expect(vs3betReport([h], { opener: 'LJ', tag: 'ip', minBB: 40, subject: 'population' }).counts.call).toBe(1)
  })

  // ---- limp vs iso ----
  test('limpVsIsoSpots: HU limp, CO isos (IP), limper calls', () => {
    const h = mk6([['call', 1, 1], ['fold', 2], ['raise', 3, 5], ['fold', 4], ['fold', 5], ['fold', 6], ['call', 1, 4]])
    const spots = limpVsIsoSpots(h)
    expect(spots.length).toBe(1)
    expect(spots[0]).toMatchObject({ limperPos: 'LJ', isoPos: 'CO', tag: 'ip', multiway: false, action: 'call' })
  })

  test('limpVsIsoSpots: limp then SB isos (OOP)', () => {
    const h = mk6([['call', 1, 1], ['fold', 2], ['fold', 3], ['fold', 4], ['raise', 5, 5], ['fold', 6], ['fold', 1]])
    expect(limpVsIsoSpots(h)[0]).toMatchObject({ limperPos: 'LJ', isoPos: 'SB', tag: 'oop', action: 'fold' })
  })

  test('limpVsIsoSpots: an SB complete is not a tracked limp (LJ–BU only)', () => {
    const h = mk6([['fold', 1], ['fold', 2], ['fold', 3], ['fold', 4], ['call', 5, 0.5], ['raise', 6, 5], ['call', 5, 4]])
    expect(limpVsIsoSpots(h).length).toBe(0)
  })

  test('limpVsIsoSpots: two limpers then iso = multiway; only the first limper tracked', () => {
    const h = mk6([['call', 1, 1], ['call', 2, 1], ['raise', 4, 6], ['fold', 5], ['fold', 6], ['raise', 1, 18], ['fold', 2]])
    const spots = limpVsIsoSpots(h)
    expect(spots.length).toBe(1)
    expect(spots[0]).toMatchObject({ limperPos: 'LJ', multiway: true, tag: 'ip', action: 'raise' })
  })

  test('limpVsIsoSpots: a re-raise before the limper acts is excluded', () => {
    // LJ limps, CO isos, BU re-raises (4-bet) before it returns to LJ → different node
    const h = mk6([['call', 1, 1], ['fold', 2], ['raise', 3, 5], ['raise', 4, 16], ['fold', 5], ['fold', 6], ['fold', 1]])
    expect(limpVsIsoSpots(h).length).toBe(0)
  })

  test('limpVsIsoSpots: a pure RFI (no limp in front) is not an iso', () => {
    const h = mk6([['raise', 1, 3.5], ['fold', 2], ['fold', 3], ['fold', 4], ['fold', 5], ['fold', 6]])
    expect(limpVsIsoSpots(h).length).toBe(0)
  })

  test('limpVsIsoReport: multiway filter + 75bb stack gate', () => {
    const hu = mk6([['call', 1, 1], ['fold', 2], ['raise', 3, 5], ['fold', 4], ['fold', 5], ['fold', 6], ['call', 1, 4]])
    const multi = mk6([['call', 1, 1], ['call', 2, 1], ['raise', 4, 6], ['fold', 5], ['fold', 6], ['fold', 1], ['fold', 2]])
    const hands = [hu, multi]
    expect(limpVsIsoReport(hands, { iso: 'ip', multiway: 'all', minBB: 75, subject: 'population' }).total).toBe(2)
    expect(limpVsIsoReport(hands, { iso: 'ip', multiway: 'hu', minBB: 75, subject: 'population' }).total).toBe(1)
    expect(limpVsIsoReport(hands, { iso: 'ip', multiway: 'multi', minBB: 75, subject: 'population' }).total).toBe(1)
    // short iso-raiser excludes the spot at 75bb+
    const short = mk6([['call', 1, 1], ['fold', 2], ['raise', 3, 5], ['fold', 4], ['fold', 5], ['fold', 6], ['call', 1, 4]], { 3: 40 })
    expect(limpVsIsoReport([short], { iso: 'ip', multiway: 'all', minBB: 75, subject: 'population' }).total).toBe(0)
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

describe('ploEval – flop hand classification', () => {
  const C = (s: string): ParsedCard[] =>
    s.split(' ').map(t => ({ rank: t.slice(0, -1), suit: t.slice(-1) as ParsedCard['suit'] }))
  const made = (hole: string, flop: string) => classifyFlop(C(hole), C(flop)).made
  const cls = (hole: string, flop: string) => classifyFlop(C(hole), C(flop))

  test('made hands', () => {
    expect(made('Ah Ac 7d 8s', 'Ks 9h 2d')).toBe('overpair')
    expect(made('Kh 8c 9d Js', 'Ks 5h 2d')).toBe('top pair')
    expect(made('7h 8c 9d Js', 'Ks 9s 2d')).toBe('middle pair')
    expect(made('7h 8c 2c Js', 'Ks 9s 2d')).toBe('bottom pair')
    expect(made('9h 9c 4d 2s', 'Ks 9d 5h')).toBe('set')
    expect(made('Kh 4c 7d 8s', 'Ks Kd 5h')).toBe('trips')
    expect(made('Ks 5c 8d 9s', 'Kh 5d 2c')).toBe('two pair')
    expect(made('Jh Tc 4d 2s', 'Qs 9h 8d')).toBe('straight')
    expect(made('Ah 2h 5c 7d', 'Kh 9h 3h')).toBe('flush')
    expect(made('8h 8c 4d 2s', 'Kc 9s 5h')).toBe('pocket pair') // underpair
  })

  test('draws + combos', () => {
    expect(cls('Ah 2h 5c 7d', 'Kh 9h 3c')).toMatchObject({ made: null, draws: ['flush draw'] })
    expect(cls('Jh Tc 4d 6s', '9h 8d 2c').draws).toContain('OESD')
    expect(cls('Qh Jc 4s 6d', 'Kh 9d 2c').draws).toContain('gutshot')
    expect(cls('Jc Tc 7s 6d', '9h 8d 2c').draws).toContain('wrap')
    expect(cls('9s 9h 8s 2c', '9d 7s 3s')).toMatchObject({ made: 'set', draws: ['flush draw'] })
    expect(cls('Ah Kd Qc Js', '9h 5d 2c').label).toBe('air')
    // made hand + draw renders as a combined label
    expect(cls('9s 9h 8s 2c', '9d 7s 3s').label).toBe('set, flush draw')
  })

  test('showdown equities among live hands sum to 100% (exact)', () => {
    const C = (s: string): ParsedCard[] =>
      s.split(' ').map(t => ({ rank: t.slice(0, -1), suit: t.slice(-1) as ParsedCard['suit'] }))
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

    // River (no cards to come): the made royal flush wins outright.
    const riv = showdownEquities([C('Js Ts'), C('Ah Ad')], C('As Ks Qs 2h 3d'), false)
    expect(riv[0]).toBeCloseTo(1, 6)
    expect(riv[1]).toBeCloseTo(0, 6)

    // Flop: overpair vs top pair — favorite, but both have live equity, summing to 1.
    const flop = showdownEquities([C('Ah Ad'), C('Kh Qd')], C('Ks 7h 2d'), false)
    expect(sum(flop)).toBeCloseTo(1, 6)
    expect(flop[0]).toBeGreaterThan(flop[1])
    expect(flop[0]).toBeGreaterThan(0.8)

    // Identical strength → a chopped pot splits 50/50.
    const chop = showdownEquities([C('Ah Kd'), C('As Kh')], C('Qc Jc Ts 5d 4h'), false)
    expect(chop[0]).toBeCloseTo(0.5, 6)
    expect(chop[1]).toBeCloseTo(0.5, 6)
  })

  test('classifyBoard on a 4-card turn', () => {
    const cb = (hole: string, board: string) => classifyBoard(C(hole), C(board))
    // flush completes on the turn
    expect(cb('Ah 2h 5c 7d', 'Kh 9h 3c Qh').made).toBe('flush')
    // straight completes on the turn (JT + Q98 board)
    expect(cb('Jh Tc 4d 2s', 'Qs 9h 8d 3c').made).toBe('straight')
    // turn pairs the top card → top pair (best 2 hole + 3 board)
    expect(cb('Kh 8c 4d 3s', '7s 5d 2c Kd').made).toBe('top pair')
    // flush DRAW still pending after the turn (2 hole + 2 board suited)
    expect(cb('Ah 2h 5c 7d', 'Kh 9h 3c Qs').draws).toContain('flush draw')
  })
})

describe('postflop – BB vs flop c-bet spot', () => {
  const C = (s: string): ParsedCard[] =>
    s.split(' ').map(t => ({ rank: t.slice(0, -1), suit: t.slice(-1) as ParsedCard['suit'] }))
  const A = (type: string, seatNumber: number, street: string, amount?: number, cards?: ParsedCard[]): HandAction =>
    ({ type: type as HandAction['type'], seatNumber, amount, cards, street: street as HandAction['street'], desc: '' })

  // 3-handed: BU(villain) opens to 3bb, SB folds, BB[hero] calls; HU flop.
  function hand(flop: string, villainFlop: HandAction[]): ParsedHand {
    return {
      handId: 'pf', tableId: '', site: 'ignition', date: '', playedAt: 0,
      gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
      players: [
        { seatNumber: 1, position: 'Dealer', isMe: false, startingStack: 100 },
        { seatNumber: 2, position: 'Small Blind', isMe: false, startingStack: 100 },
        { seatNumber: 3, position: 'Big Blind', isMe: true, startingStack: 100 },
      ],
      actions: [
        A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 1, 'preflop', undefined, C('As Ks Qd Jc')),
        A('deal_hole', 3, 'preflop', undefined, C('Th 9h 8s 7d')),
        A('raise', 1, 'preflop', 3), A('fold', 2, 'preflop'), A('call', 3, 'preflop', 2),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C(flop)),
        ...villainFlop,
      ].filter(a => a.seatNumber !== undefined || a.type === 'deal_flop'),
    } as ParsedHand
  }

  test('flopTexture & connectivity', () => {
    expect(flopTexture(C('As Ks Qs'))).toEqual({ suits: 'mono', paired: false })
    expect(flopTexture(C('Ah Kh 2d'))).toEqual({ suits: 'twotone', paired: false })
    expect(flopTexture(C('As Ad Kc'))).toEqual({ suits: 'rainbow', paired: true })
    expect(straightPossibleFlop(C('6s 5h 4d'))).toBe(true)   // 654
    expect(straightPossibleFlop(C('Ts 9h 8d'))).toBe(true)   // T98
    expect(straightPossibleFlop(C('Qs 6h 3d'))).toBe(false)  // Q63 — span 9, no straight
    expect(straightPossibleFlop(C('Ks 7h 2d'))).toBe(false)
    expect(straightPossibleFlop(C('Ah 2c 3d'))).toBe(true)   // wheel A23
    expect(straightPossibleFlop(C('Ts 9h 5d'))).toBe(false)  // span 5 — only draws, no made straight
  })

  test('board texture across turn/river (4- and 5-card boards)', () => {
    // turn brings a straight that the flop didn't allow: Q63 + 5 → 3-5-6 spans 3
    expect(straightPossibleBoard(C('Qs 6h 3d'))).toBe(false)
    expect(straightPossibleBoard(C('Qs 6h 3d 5c'))).toBe(true)
    // a brick turn keeps a dry flop dry
    expect(straightPossibleBoard(C('Ks 7h 2d Qc'))).toBe(false)
    // 5-card board: any 3 within a 5-window completes it
    expect(straightPossibleBoard(C('Ks 7h 2d Qc 4s'))).toBe(false) // K,Q isolated; 7,4,2 too spread
    expect(straightPossibleBoard(C('Ks 7h 2d Qc Js'))).toBe(true)  // J-Q-K
    // paired detection scales with the board
    expect(boardPaired(C('Ah Kd 2c'))).toBe(false)
    expect(boardPaired(C('Ah Kd 2c Ks'))).toBe(true)              // turn pairs the K
    expect(boardPaired(C('Ah Kd 2c 7s 9h'))).toBe(false)
    // suit texture by distinct-suit count, scaling with the board
    expect(boardSuits(C('As Ks Qs'))).toBe('mono')
    expect(boardSuits(C('As Ks Qs 2s'))).toBe('mono')
    expect(boardSuits(C('As Ks Qs 2h'))).toBe('twotone')
    expect(boardSuits(C('As Kh Qd'))).toBe('rainbow')
  })


  test('extractFlopSpot: SRP HU, OOP = first to act, normalized actions', () => {
    const h = hand('Ks 7h 2d', [A('check', 3, 'flop'), A('bet', 1, 'flop', 3), A('call', 3, 'flop', 3)])
    const s = extractFlopSpot(h)!
    expect(s.potType).toBe('SRP')
    expect(s.oopPos).toBe('BB')          // hero (seat3) acts first
    expect(s.ipPos).toBe('BU')           // opener (seat1)
    expect(s.oopIsHero).toBe(true)
    expect(s.actions.map(a => `${a.actor}:${a.type}`)).toEqual(['oop:check', 'ip:bet', 'oop:call'])
    expect(s.ipClass?.made).toBe('top pair') // As Ks Qd Jc on Ks → top pair
  })

  test('bet% and check-raise% sizing (raise = extra over the call, vs pot after call)', () => {
    // preflop pot = SB .5 + BU 3 + BB 3 = 6.5; flop: BB checks, BU bets 3, BB raises to 12
    const h = hand('Ks 7h 2d', [A('check', 3, 'flop'), A('bet', 1, 'flop', 3), A('raise', 3, 'flop', 12), A('fold', 1, 'flop')])
    const s = extractFlopSpot(h)!
    expect(s.actions[1].betPct).toBeCloseTo(3 / 6.5, 4)          // bet 3 into 6.5
    expect(s.actions[2].betPct).toBeCloseTo((12 - 3) / (9.5 + 3), 4) // (12-3) / (6.5+3 + 3) = 9/12.5 = 0.72
  })

  test('formationReport: hero node + prior + check-raise response (SRP BB vs c-bet)', () => {
    const faced = hand('Ks 7h 2d', [A('check', 3, 'flop'), A('bet', 1, 'flop', 3), A('call', 3, 'flop', 3)])
    const back = hand('Ks 7h 2d', [A('check', 3, 'flop'), A('check', 1, 'flop')])
    const xr = hand('Ks 7h 2d', [A('check', 3, 'flop'), A('bet', 1, 'flop', 3), A('raise', 3, 'flop', 12), A('fold', 1, 'flop')])
    const r = formationReport(extractSpots([faced, back, xr]), 'srp-bb-vs-ip', 'flop-xb', 'hero', EMPTY_FILTER)

    expect(r.heroNode.total).toBe(2)            // faced (call) + xr (raise) reach the node; back does not
    expect(r.prior!.total).toBe(3)              // all three checked to the IP raiser
    expect(r.responses[0].total).toBe(1)        // only xr reaches "vs your check-raise"
    expect(r.listSpots.length).toBe(2)
    // texture filter (rainbow board) excludes monotone
    expect(formationReport(extractSpots([faced]), 'srp-bb-vs-ip', 'flop-xb', 'hero', { ...EMPTY_FILTER, suits: 'mono' }).heroNode.total).toBe(0)
  })

  test('formationReport: 3BP OOP first-to-act with villain response nodes', () => {
    // 3-handed: BU opens 3, SB folds, BB[hero] 3-bets to 10, BU calls; HU flop, BB bets, BU calls
    const h3bet = {
      handId: '3bp', tableId: '', site: 'ignition', date: '', playedAt: 0,
      gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
      players: [
        { seatNumber: 1, position: 'Dealer', isMe: false, startingStack: 100 },
        { seatNumber: 2, position: 'Small Blind', isMe: false, startingStack: 100 },
        { seatNumber: 3, position: 'Big Blind', isMe: true, startingStack: 100 },
      ],
      actions: [
        A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 1, 'preflop', undefined, C('As Ks Qd Jc')),
        A('deal_hole', 3, 'preflop', undefined, C('Ah Ac 7d 8s')),
        A('raise', 1, 'preflop', 3), A('fold', 2, 'preflop'), A('raise', 3, 'preflop', 10), A('call', 1, 'preflop', 7),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('bet', 3, 'flop', 6), A('call', 1, 'flop', 6),
      ].filter(a => a.seatNumber !== undefined || a.type === 'deal_flop'),
    } as ParsedHand
    const s = extractFlopSpot(h3bet)!
    expect(s.potType).toBe('3BP')
    expect(s.oopPos).toBe('BB')
    const r = formationReport(extractSpots([h3bet]), '3bp-oop', 'flop-initial', 'hero', EMPTY_FILTER)
    expect(r.heroNode.total).toBe(1)                 // hero acts first (bet)
    expect(r.prior).toBeUndefined()
    expect(r.responses.find(n => n.label.includes('vs your bet'))!.total).toBe(1) // villain faced the bet
  })

  test('turn capture + formationReport on a turn node (X-B-C → turn X-B)', () => {
    // BU opens, BB[hero] calls; flop Ks7h2d: BB check, BU c-bet, BB call (X-B-C closes);
    // turn Qs: BB check, BU bet, BB call → reaches the turn X-B node (OOP facing a bet).
    const h = {
      handId: 'turn', tableId: '', site: 'ignition', date: '', playedAt: 0,
      gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
      players: [
        { seatNumber: 1, position: 'Dealer', isMe: false, startingStack: 100 },
        { seatNumber: 2, position: 'Small Blind', isMe: false, startingStack: 100 },
        { seatNumber: 3, position: 'Big Blind', isMe: true, startingStack: 100 },
      ],
      actions: [
        A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 1, 'preflop', undefined, C('As Ks Qd Jc')),
        A('deal_hole', 3, 'preflop', undefined, C('Th 9h 8s 7d')),
        A('raise', 1, 'preflop', 3), A('fold', 2, 'preflop'), A('call', 3, 'preflop', 2),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('check', 3, 'flop'), A('bet', 1, 'flop', 3), A('call', 3, 'flop', 3),
        A('deal_turn', undefined as unknown as number, 'turn', undefined, C('Qs')),
        A('check', 3, 'turn'), A('bet', 1, 'turn', 6), A('call', 3, 'turn', 6),
      ].filter(a => a.seatNumber !== undefined || a.type === 'deal_flop' || a.type === 'deal_turn'),
    } as ParsedHand

    const s = extractFlopSpot(h)!
    expect(s.turnCard).toEqual(C('Qs')[0])
    expect(s.turnActions.map(a => `${a.actor}:${a.type}`)).toEqual(['oop:check', 'ip:bet', 'oop:call'])
    // board texture: flop Ks7h2d (dry), turn Qs keeps it dry & unpaired
    expect(s.flopRanks).toEqual(['K', '7', '2'])
    expect(s.straighty).toBe(false)
    expect(s.turnStraighty).toBe(false)
    expect(s.turnPaired).toBe(false)

    // hero (BB/OOP) facing the turn bet on the X-B-C line
    const r = formationReport(extractSpots([h]), 'srp-bb-vs-ip', 'xbc-xb', 'hero', EMPTY_FILTER)
    expect(r.heroNode.total).toBe(1)
    expect(r.heroNode.actionCounts.call).toBe(1)
    expect(r.prior!.total).toBe(1)              // villain's turn bet (the prior decision)
    expect(r.listSpots[0].cards).toEqual(C('Th 9h 8s 7d'))
  })

  test('flop raise nodes: IP vs check-raise (X-B-R) and the X-B-R-C turn line', () => {
    // BU opens, BB[hero] calls; flop: BB check, BU bet, BB raise, BU call (X-B-R-C),
    // then a turn is dealt.
    const h = hand('Ks 7h 2d', [
      A('check', 3, 'flop'), A('bet', 1, 'flop', 3), A('raise', 3, 'flop', 12), A('call', 1, 'flop', 9),
    ])
    h.actions.push(
      A('deal_turn', undefined as unknown as number, 'turn', undefined, C('Qs')),
      A('check', 3, 'turn'),
    )
    const s = extractFlopSpot(h)!
    expect(s.actions.map(a => `${a.actor}:${a.type}`)).toEqual(['oop:check', 'ip:bet', 'oop:raise', 'ip:call'])

    // IP (BU, not hero) facing the check-raise → population mode
    const r = formationReport(extractSpots([h]), 'srp-bb-vs-ip', 'flop-xbr', 'population', EMPTY_FILTER)
    expect(r.heroNode.total).toBe(1)
    expect(r.heroNode.actionCounts.call).toBe(1)
    // the X-B-R-C closing line reaches a turn node (OOP first to act = hero here)
    const turn = formationReport(extractSpots([h]), 'srp-bb-vs-ip', 'xbrc-initial', 'hero', EMPTY_FILTER)
    expect(turn.heroNode.total).toBe(1)
  })

  test('river capture + formationReport on a river node (X-B-C / X-B-C)', () => {
    // BU opens, BB[hero] calls; flop X-B-C, turn X-B-C, river: BB check, BU bet, BB call.
    const h = {
      handId: 'river', tableId: '', site: 'ignition', date: '', playedAt: 0,
      gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
      players: [
        { seatNumber: 1, position: 'Dealer', isMe: false, startingStack: 100 },
        { seatNumber: 2, position: 'Small Blind', isMe: false, startingStack: 100 },
        { seatNumber: 3, position: 'Big Blind', isMe: true, startingStack: 100 },
      ],
      actions: [
        A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 1, 'preflop', undefined, C('As Ks Qd Jc')),
        A('deal_hole', 3, 'preflop', undefined, C('Th 9h 8s 7d')),
        A('raise', 1, 'preflop', 3), A('fold', 2, 'preflop'), A('call', 3, 'preflop', 2),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('check', 3, 'flop'), A('bet', 1, 'flop', 3), A('call', 3, 'flop', 3),
        A('deal_turn', undefined as unknown as number, 'turn', undefined, C('Qs')),
        A('check', 3, 'turn'), A('bet', 1, 'turn', 6), A('call', 3, 'turn', 6),
        A('deal_river', undefined as unknown as number, 'river', undefined, C('2c')),
        A('check', 3, 'river'), A('bet', 1, 'river', 12), A('call', 3, 'river', 12),
      ].filter(a => a.seatNumber !== undefined || ['deal_flop', 'deal_turn', 'deal_river'].includes(a.type)),
    } as ParsedHand

    const s = extractFlopSpot(h)!
    expect(s.riverCard).toEqual(C('2c')[0])
    expect(s.riverActions.map(a => `${a.actor}:${a.type}`)).toEqual(['oop:check', 'ip:bet', 'oop:call'])

    // hero (BB/OOP) facing the river bet on the X-B-C / X-B-C line
    const r = formationReport(extractSpots([h]), 'srp-bb-vs-ip', 'xbc-xbc-xb', 'hero', EMPTY_FILTER)
    expect(r.heroNode.total).toBe(1)
    expect(r.heroNode.actionCounts.call).toBe(1)
    expect(r.prior!.total).toBe(1)              // villain's river bet
    expect(r.listSpots[0].cards).toEqual(C('Th 9h 8s 7d'))
  })

  test('squeeze / cold-call pot is NOT a clean 3BP (rejected)', () => {
    // BU opens, SB[hero] cold-calls, BB squeezes, BU folds, SB calls → 2 raises, HU,
    // but a caller sits between the open and the 3-bet → not a clean 3BP.
    const squeeze = {
      handId: 'sq', tableId: '', site: 'ignition', date: '', playedAt: 0,
      gameType: 'OMAHA Pot Limit', currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
      players: [
        { seatNumber: 1, position: 'Dealer', isMe: false, startingStack: 100 },
        { seatNumber: 2, position: 'Small Blind', isMe: true, startingStack: 100 },
        { seatNumber: 3, position: 'Big Blind', isMe: false, startingStack: 100 },
      ],
      actions: [
        A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 2, 'preflop', undefined, C('Kh Qd Jc Ts')),
        A('raise', 1, 'preflop', 3), A('call', 2, 'preflop', 2.5), A('raise', 3, 'preflop', 10),
        A('fold', 1, 'preflop'), A('call', 2, 'preflop', 7),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('check', 2, 'flop'), A('bet', 3, 'flop', 6), A('call', 2, 'flop', 6),
      ].filter(a => a.seatNumber !== undefined || a.type === 'deal_flop'),
    } as ParsedHand
    expect(extractFlopSpot(squeeze)).toBeNull()
  })

  // generic builder for multi-player synthetic hands
  const mk = (players: [number, string, boolean, number][], acts: HandAction[]): ParsedHand => ({
    handId: 'g', tableId: '', site: 'ignition', date: '', playedAt: 0, gameType: 'OMAHA Pot Limit',
    currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '',
    players: players.map(([seatNumber, position, isMe, startingStack]) => ({ seatNumber, position, isMe, startingStack })),
    actions: acts.filter(a => a.seatNumber !== undefined || a.type === 'deal_flop'),
  } as ParsedHand)

  test('preflop sanity filters reject short stacks / tiny opens / small 3-bets', () => {
    const srp = (openTo: number, stack: number) => mk(
      [[1, 'Dealer', false, stack], [2, 'Small Blind', false, stack], [3, 'Big Blind', true, stack]],
      [A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 1, 'preflop', undefined, C('As Ks Qd Jc')), A('deal_hole', 3, 'preflop', undefined, C('Th 9h 8s 7d')),
        A('raise', 1, 'preflop', openTo), A('fold', 2, 'preflop'), A('call', 3, 'preflop', openTo - 1),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('check', 3, 'flop'), A('bet', 1, 'flop', 2)])
    expect(extractFlopSpot(srp(3, 100))).not.toBeNull()  // baseline ok
    expect(extractFlopSpot(srp(3, 50))).toBeNull()        // < 75bb
    expect(extractFlopSpot(srp(2, 100))).toBeNull()       // open < 3bb
    // small 3-bet (1 → 3 → 6): (6-3)/(4.5+3) = 40% < 75%
    const small3bet = mk(
      [[1, 'Dealer', false, 100], [2, 'Small Blind', false, 100], [3, 'Big Blind', true, 100]],
      [A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 1, 'preflop', undefined, C('As Ks Qd Jc')), A('deal_hole', 3, 'preflop', undefined, C('Th 9h 8s 7d')),
        A('raise', 1, 'preflop', 3), A('fold', 2, 'preflop'), A('raise', 3, 'preflop', 6), A('call', 1, 'preflop', 3),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('bet', 3, 'flop', 4)])
    expect(extractFlopSpot(small3bet)).toBeNull()
  })

  test('SRP · IP vs RFI: hero is the IP caller facing the OOP c-bet', () => {
    // HJ(seat5) opens, BU[hero](seat1) calls, blinds fold; flop HJ bets, BU calls
    const h = mk(
      [[1, 'Dealer', true, 100], [2, 'Small Blind', false, 100], [3, 'Big Blind', false, 100],
        [4, 'UTG', false, 100], [5, 'UTG+1', false, 100], [6, 'UTG+2', false, 100]],
      [A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 5, 'preflop', undefined, C('Ts 9s 8d 2c')), A('deal_hole', 1, 'preflop', undefined, C('Ah Kd Qc Jh')),
        A('fold', 4, 'preflop'), A('raise', 5, 'preflop', 3), A('fold', 6, 'preflop'),
        A('call', 1, 'preflop', 3), A('fold', 2, 'preflop'), A('fold', 3, 'preflop'),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('bet', 5, 'flop', 3), A('call', 1, 'flop', 3)])
    const s = extractFlopSpot(h)!
    expect(s.oopPos).toBe('HJ'); expect(s.ipPos).toBe('BU'); expect(s.ipIsHero).toBe(true)
    const r = formationReport(extractSpots([h]), 'srp-coldcall', 'flop-b', 'hero', EMPTY_FILTER)
    expect(r.heroNode.total).toBe(1)              // hero (IP) faced the c-bet
    expect(r.prior!.total).toBe(1)                // the OOP c-bet decision
    expect(r.listSpots[0].cards).toEqual(C('Ah Kd Qc Jh')) // hero's (BU) cards
  })

  test('3BP OOP vs raiser: hero opens, IP 3-bets, hero calls and is OOP', () => {
    // LJ[hero](seat4) opens, CO(seat6) 3-bets, hero calls; flop hero bets
    const h = mk(
      [[1, 'Dealer', false, 100], [2, 'Small Blind', false, 100], [3, 'Big Blind', false, 100],
        [4, 'UTG', true, 100], [5, 'UTG+1', false, 100], [6, 'UTG+2', false, 100]],
      [A('post_blind', 2, 'preflop', 0.5), A('post_blind', 3, 'preflop', 1),
        A('deal_hole', 4, 'preflop', undefined, C('Ah Ac Kd Qd')), A('deal_hole', 6, 'preflop', undefined, C('Ts 9s 8d 7c')),
        A('raise', 4, 'preflop', 3), A('fold', 5, 'preflop'), A('raise', 6, 'preflop', 11),
        A('fold', 1, 'preflop'), A('fold', 2, 'preflop'), A('fold', 3, 'preflop'), A('call', 4, 'preflop', 8),
        A('deal_flop', undefined as unknown as number, 'flop', undefined, C('Ks 7h 2d')),
        A('bet', 4, 'flop', 6), A('call', 6, 'flop', 6)])
    const s = extractFlopSpot(h)!
    expect(s.potType).toBe('3BP'); expect(s.oopPos).toBe('LJ'); expect(s.ipPos).toBe('CO')
    const r = formationReport(extractSpots([h]), '3bp-ip', 'flop-initial', 'hero', EMPTY_FILTER)
    expect(r.heroNode.total).toBe(1)
    expect(r.responses.find(n => n.label.includes('vs your bet'))!.total).toBe(1)
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

describe('graph – net & rake (attributed only when hero wins)', () => {
  const C = (s: string): ParsedCard[] =>
    s.split(' ').map(t => ({ rank: t.slice(0, -1), suit: t.slice(-1) as ParsedCard['suit'] }))
  const A = (type: string, seatNumber: number, street: string, amount?: number, cards?: ParsedCard[]): HandAction =>
    ({ type: type as HandAction['type'], seatNumber, amount, cards, street: street as HandAction['street'], desc: '' })

  // HU, bb=1. Hero(SB) raises to 3, BB calls, flop, hero bets 2, X folds, hero wins.
  // Total pot 6, hero collects 5.70 → rake 0.30.
  const base = (winnerSeat: number, betSeat: number): ParsedHand => ({
    handId: 'g', tableId: '', site: 'ignition', date: '', playedAt: 1, gameType: 'OMAHA Pot Limit',
    currency: 'USD', smallBlind: 0.5, bigBlind: 1, initialStep: 0, rawText: '', totalPot: 6,
    players: [
      { seatNumber: 1, position: 'Small Blind', isMe: true, startingStack: 100 },
      { seatNumber: 2, position: 'Big Blind', isMe: false, startingStack: 100 },
    ],
    actions: [
      A('post_blind', 1, 'preflop', 0.5), A('post_blind', 2, 'preflop', 1),
      A('deal_hole', 1, 'preflop', undefined, C('Ks As 8h 6s')),
      A('deal_hole', 2, 'preflop', undefined, C('8s Qh Kd Th')),
      A('raise', 1, 'preflop', 3), A('call', 2, 'preflop', 2),
      A('deal_flop', undefined as unknown as number, 'flop', undefined, C('2h 2c 3d')),
      A('bet', betSeat, 'flop', 2), A('fold', betSeat === 1 ? 2 : 1, 'flop'),
      A('return_bet', betSeat, 'flop', 2), A('result', winnerSeat, 'flop', 5.7),
    ],
  } as ParsedHand)

  test('hero wins → rake attributed; net is profit', () => {
    const s = handStat(base(1, 1))!   // hero (seat 1) bets and wins
    expect(s.net).toBeCloseTo(2.7, 5)   // won 5.70, put in 3.00
    expect(s.rake).toBeCloseTo(0.3, 5)  // full pot rake, in BB
  })

  test('hero folds / villain wins → no rake attributed', () => {
    const s = handStat(base(2, 2))!   // villain (seat 2) bets and wins
    expect(s.net).toBeCloseTo(-3, 5)    // hero put in 3.00, won nothing
    expect(s.rake).toBe(0)
  })
})
