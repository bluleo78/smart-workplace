import { describe, expect, it } from 'vitest'

import {
  type AwarenessStates,
  derivePeople,
  jumpAnchor,
  peopleSignature,
  PRESENCE_COLOR_COUNT,
  presenceColorIndex,
  presenceColorVar,
  presenceStyle,
  splitVisible,
} from './presence'

const rel = (n: number) => ({ type: null, tname: 'default', item: { client: n, clock: 0 }, assoc: 0 })
const cursor = (n: number) => ({ anchor: rel(n), head: rel(n) })
const marker = (userId: number, name: string, n = 1) => ({ id: `m${userId}-${n}`, userId, name, anchor: rel(n) })
const SELF = { clientId: 100, userId: 1 }

/** 순서 있는 awareness 상태 — Map 삽입 순서 = 들어온 순서. */
const statesOf = (entries: Array<[number, Record<string, unknown> | null]>): AwarenessStates => new Map(entries)

describe('presenceColorIndex', () => {
  it('is deterministic and within 1..8', () => {
    for (const id of [1, 2, 7, 8, 9, 123456, -3, 0]) {
      const i = presenceColorIndex(id)
      expect(i).toBe(presenceColorIndex(id))
      expect(i).toBeGreaterThanOrEqual(1)
      expect(i).toBeLessThanOrEqual(PRESENCE_COLOR_COUNT)
    }
  })

  it('gives consecutive ids different colors so a small team never collides', () => {
    const colors = new Set(Array.from({ length: PRESENCE_COLOR_COUNT }, (_, i) => presenceColorIndex(i + 1)))
    expect(colors.size).toBe(PRESENCE_COLOR_COUNT)
  })

  it('maps to the token variable', () => {
    expect(presenceColorVar(2)).toBe(`var(--presence-${presenceColorIndex(2)})`)
  })

  it('exposes the person color as the --presence-color variable for React elements', () => {
    expect(presenceStyle(2)).toEqual({ '--presence-color': presenceColorVar(2) })
  })
})

describe('derivePeople', () => {
  it('lists other people in arrival order and leaves me out', () => {
    const people = derivePeople(
      statesOf([
        [100, { user: { id: 1, name: '나' } }],
        [201, { user: { id: 2, name: '김철수' } }],
        [301, { user: { id: 3, name: '박민수' } }],
      ]),
      SELF,
    )
    expect(people.map((p) => p.name)).toEqual(['김철수', '박민수'])
  })

  it('merges tabs of one person into one entry', () => {
    const people = derivePeople(
      statesOf([
        [201, { user: { id: 2, name: '김철수' } }],
        [202, { user: { id: 2, name: '김철수' }, cursor: cursor(2) }],
      ]),
      SELF,
    )
    expect(people).toEqual([{ userId: 2, name: '김철수', aiWriting: false, editing: true, clientIds: [201, 202] }])
  })

  it('hides my other tabs (same user id, other client)', () => {
    expect(derivePeople(statesOf([[150, { user: { id: 1, name: '나' }, cursor: cursor(1) }]]), SELF)).toEqual([])
  })

  it('learns my user id from my own state when the caller does not know it yet', () => {
    const people = derivePeople(
      statesOf([
        [100, { user: { id: 1, name: '나' } }],
        [150, { user: { id: 1, name: '나' } }],
      ]),
      { clientId: 100, userId: null },
    )
    expect(people).toEqual([])
  })

  it('marks a person as AI writing from their own /ai marker and puts them first', () => {
    const people = derivePeople(
      statesOf([
        [201, { user: { id: 2, name: '김철수' } }],
        [301, { user: { id: 3, name: '이영희' }, aiMarkers: [marker(3, '이영희')] }],
      ]),
      SELF,
    )
    expect(people.map((p) => [p.name, p.aiWriting])).toEqual([
      ['이영희', true],
      ['김철수', false],
    ])
  })

  it('shows a person who only has a server marker (MCP · chat assistant) as AI writing', () => {
    const people = derivePeople(statesOf([[9, { aiMarkers: [marker(9, '김에이아이')] }]]), SELF)
    expect(people).toEqual([{ userId: 9, name: '김에이아이', aiWriting: true, editing: false, clientIds: [] }])
  })

  it('skips server markers for me and states without a valid user', () => {
    const people = derivePeople(
      statesOf([
        [9, { aiMarkers: [marker(1, '나')] }],
        [401, { cursor: cursor(4) }],
        [402, { user: { id: 'x', name: '이상한 값' } }],
        [403, null],
      ]),
      SELF,
    )
    expect(people).toEqual([])
  })

  it("prefers the name from the person's own user field even when a server marker came first", () => {
    const people = derivePeople(
      statesOf([
        [9, { aiMarkers: [marker(3, '서버가 아는 이름')] }],
        [301, { user: { id: 3, name: '이영희' } }],
      ]),
      SELF,
    )
    expect(people).toEqual([{ userId: 3, name: '이영희', aiWriting: true, editing: false, clientIds: [301] }])
  })

  it('falls back to a readable name when the name is empty', () => {
    expect(derivePeople(statesOf([[9, { aiMarkers: [marker(5, '')] }]]), SELF)[0].name).toBe('이름 없는 사용자')
  })
})

describe('peopleSignature', () => {
  it('changes when membership or status changes, not otherwise', () => {
    const a = derivePeople(statesOf([[201, { user: { id: 2, name: '김철수' } }]]), SELF)
    const b = derivePeople(statesOf([[201, { user: { id: 2, name: '김철수' } }]]), SELF)
    const c = derivePeople(statesOf([[201, { user: { id: 2, name: '김철수' }, cursor: cursor(2) }]]), SELF)
    expect(peopleSignature(a)).toBe(peopleSignature(b))
    expect(peopleSignature(a)).not.toBe(peopleSignature(c))
  })

  it('stays the same when only the cursor moves', () => {
    const at = (n: number) => derivePeople(statesOf([[201, { user: { id: 2, name: '김철수' }, cursor: cursor(n) }]]), SELF)
    expect(peopleSignature(at(2))).toBe(peopleSignature(at(5)))
  })
})

describe('splitVisible', () => {
  it('shows up to max and counts the rest', () => {
    expect(splitVisible([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 })
    expect(splitVisible([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 })
    expect(splitVisible([1, 2], 1)).toEqual({ shown: [1], more: 1 })
  })
})

describe('jumpAnchor', () => {
  it("prefers the person's cursor head, then their AI marker anchor", () => {
    const states = statesOf([
      [201, { user: { id: 2, name: '김철수' }, cursor: cursor(7) }],
      [9, { aiMarkers: [marker(3, '이영희', 8)] }],
      [301, { user: { id: 4, name: '최수진' } }],
    ])
    const [kim, lee, choi] = ['김철수', '이영희', '최수진'].map((n) => derivePeople(states, SELF).find((p) => p.name === n)!)
    expect(jumpAnchor(states, kim)).toEqual(rel(7))
    expect(jumpAnchor(states, lee)).toEqual(rel(8))
    expect(jumpAnchor(states, choi)).toBeNull()
  })

  it("uses a later tab's cursor when the person's first tab has none", () => {
    const states = statesOf([
      [201, { user: { id: 2, name: '김철수' } }],
      [202, { user: { id: 2, name: '김철수' }, cursor: cursor(6) }],
    ])
    const [kim] = derivePeople(states, SELF)
    expect(kim.clientIds).toEqual([201, 202])
    expect(jumpAnchor(states, kim)).toEqual(rel(6))
  })
})
