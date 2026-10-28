// 내 그룹을 사람으로 펼치기(WP-1023 → WP-1056 공통화) — 중복 빼기·더한 수·안내 문구.
import { describe, expect, it } from 'vitest'

import { addGroupMembers, groupExpansionMessage } from './personalGroups'

describe('사람·팀 추가(WP-1023)', () => {
  it('내 그룹 구성원 중 아직 없는 사람만 뒤에 더하고 더한 수·뺀 수를 센다(구성원 중복은 한 번)', () => {
    expect(addGroupMembers([3, 5], [5, 7, 8, 7])).toEqual({ userIds: [3, 5, 7, 8], added: 2, skipped: 1 })
    expect(addGroupMembers([3], [3])).toEqual({ userIds: [3], added: 0, skipped: 1 })
    expect(addGroupMembers([], [])).toEqual({ userIds: [], added: 0, skipped: 0 })
    // 빼는 사람(나·공유를 만든 사람)은 더하지도 이미 있는 수로 세지도 않는다.
    expect(addGroupMembers([3], [1, 3, 9], [1, 3])).toEqual({ userIds: [3, 9], added: 1, skipped: 0 })
  })

  it('펼친 뒤 안내 문구', () => {
    expect(groupExpansionMessage('개발 스터디', 3, 1)).toBe('개발 스터디에서 3명 추가 (이미 있는 1명 제외)')
    expect(groupExpansionMessage('개발 스터디', 2, 0)).toBe('개발 스터디에서 2명 추가')
    expect(groupExpansionMessage('개발 스터디', 0, 2)).toBe('개발 스터디의 2명은 이미 모두 있습니다')
    expect(groupExpansionMessage('개발 스터디', 0, 0)).toBe('개발 스터디에 추가할 사람이 없습니다')
  })
})
