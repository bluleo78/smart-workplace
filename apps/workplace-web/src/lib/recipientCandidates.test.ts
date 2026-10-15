// 받는 사람 후보 거르기 단위 테스트(WP-412) — 이전 E2E messaging-compose-selfdm(피커가 본인을 제외)를 대체.
import { describe, expect, it } from 'vitest'

import { recipientCandidates } from './recipientCandidates'

const u = (id: number, isActive = true) => ({ id, isActive })

describe('recipientCandidates', () => {
  it('본인(제외 대상)은 검색 결과에 있어도 후보에서 뺀다', () => {
    expect(recipientCandidates([u(1), u(2)], new Set([1]), new Set()).map((x) => x.id)).toEqual([2])
  })
  it('비활성 사용자와 이미 고른 상대도 뺀다', () => {
    expect(recipientCandidates([u(2), u(3, false), u(4)], undefined, new Set([4])).map((x) => x.id)).toEqual([2])
  })
})
