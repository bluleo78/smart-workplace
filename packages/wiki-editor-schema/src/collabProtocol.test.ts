import { describe, expect, it } from 'vitest'

import { parseAiMarkers } from './collabProtocol'

// awareness 는 클라이언트 자기 신고 값이라 모양을 믿지 않는다 — 깨진 항목은 버리고 나머지만 그린다.
describe('parseAiMarkers', () => {
  it('keeps well-formed markers and drops the rest', () => {
    const ok = { id: 'm1', userId: 5, name: '양동희', anchor: { type: null, tname: 'default', item: null, assoc: 0 } }
    expect(parseAiMarkers([ok, { id: 2 }, null, 'x', { ...ok, name: 3 }, { ...ok, anchor: null }])).toEqual([ok])
  })

  it('returns an empty list for non-arrays (cleared field)', () => {
    expect(parseAiMarkers(null)).toEqual([])
    expect(parseAiMarkers(undefined)).toEqual([])
    expect(parseAiMarkers({})).toEqual([])
  })
})
