import { describe, expect, it } from 'vitest'

import {
  CLOSE_DELETED,
  CLOSE_FORBIDDEN,
  CLOSE_TOKEN_EXPIRED,
  parseAiMarkers,
  REVALIDATE_REASON_DELETED,
} from './collabProtocol'

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

describe('종료 코드', () => {
  // 웹은 코드로 종단을 가른다 — 겹치면 삭제를 권한 회수로(또는 만료로) 오판해 안내·재접속이 어긋난다.
  it('삭제(4404)는 권한 회수·토큰 만료와 다른 앱 전용 코드다', () => {
    const codes = [CLOSE_TOKEN_EXPIRED.code, CLOSE_FORBIDDEN.code, CLOSE_DELETED.code]
    expect(new Set(codes).size).toBe(3)
    for (const c of codes) expect(c >= 4000 && c <= 4999).toBe(true)
    expect(CLOSE_DELETED.reason).toBe(REVALIDATE_REASON_DELETED)
  })
})
