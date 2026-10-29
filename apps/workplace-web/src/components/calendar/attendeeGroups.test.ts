// 일정 참석자에 조직·내 그룹 풀어 넣기의 확인 줄 문구와 한도(WP-1059) — 넣을 사람 계산은 members/personalGroups.test.ts.
import { describe, expect, test } from 'vitest'

import type { UserGroupMemberHit } from '../../types/userGroup'
import { planGroupExpansion } from '../members/personalGroups'
import { ATTENDEE_LIMIT, groupInviteDetail, groupInviteTitle, isOverLimit } from './attendeeGroups'

/** 구성원 찾기 응답 한 줄 — 사람(MEMBER) 기본. */
function hit(targetId: number, name: string, targetType: 'MEMBER' | 'EXTERNAL' = 'MEMBER'): UserGroupMemberHit {
  return { targetType, targetId, name, email: null, title: null, organization: null, groupId: 10, groupPath: [] }
}

describe('한도', () => {
  test('넣을 사람이 남은 자리보다 많으면 한도 초과다', () => {
    const hits = Array.from({ length: 3 }, (_, i) => hit(10 + i, `사람${i}`))
    expect(isOverLimit(planGroupExpansion(hits, [], 1, 3))).toBe(false)
    expect(isOverLimit(planGroupExpansion(hits, [], 1, 2))).toBe(true)
  })
})

describe('확인 줄 문구', () => {
  test('넣을 사람 수와 뺀 사람(이미 있는 사람·나)을 알린다', () => {
    const plan = planGroupExpansion([hit(1, '나'), hit(2, '홍길동'), hit(3, '김민수')], [2], 1, ATTENDEE_LIMIT)
    expect(groupInviteTitle('개발팀', plan)).toBe('개발팀 구성원 1명을 참석자로 추가합니다')
    expect(groupInviteDetail(plan)).toBe('이미 있는 1명·나 제외 · 넣은 뒤 한 명씩 뺄 수 있습니다')
  })

  test('뺀 사람이 없으면 빼기 안내 없이 넣은 뒤 뺄 수 있다는 것만', () => {
    const plan = planGroupExpansion([hit(3, '김민수')], [], 1, ATTENDEE_LIMIT)
    expect(groupInviteDetail(plan)).toBe('넣은 뒤 한 명씩 뺄 수 있습니다')
  })

  test('모두 이미 참석자면 그 사실만 알리고 부연은 없다', () => {
    const plan = planGroupExpansion([hit(2, '홍길동')], [2], 1, ATTENDEE_LIMIT)
    expect(groupInviteTitle('개발팀', plan)).toBe('개발팀의 1명은 이미 모두 있습니다')
    expect(groupInviteDetail(plan)).toBe('')
  })

  test('한도를 넘으면 한도를 알린다 — 남은 자리가 한도보다 적으면(만들기에서 이미 고른 사람) 남은 자리를 함께', () => {
    const many = Array.from({ length: ATTENDEE_LIMIT + 1 }, (_, i) => hit(10 + i, `사람${i}`))
    expect(groupInviteDetail(planGroupExpansion(many, [], 1, ATTENDEE_LIMIT))).toBe(`한 번에 ${ATTENDEE_LIMIT}명까지 넣을 수 있습니다`)
    const plan = planGroupExpansion([hit(3, '김민수'), hit(4, '이서연')], [], 1, 1)
    expect(groupInviteDetail(plan)).toBe(`참석자는 ${ATTENDEE_LIMIT}명까지라 1명만 더 넣을 수 있습니다`)
  })

  test('남은 자리가 0 이하면 음수 대신 더 넣을 수 없다고 알린다(WP-1112)', () => {
    const hits = [hit(3, '김민수'), hit(4, '이서연')]
    for (const capacity of [0, -3]) {
      expect(groupInviteDetail(planGroupExpansion(hits, [], 1, capacity))).toBe(`참석자는 ${ATTENDEE_LIMIT}명까지라 더 넣을 수 없습니다`)
    }
  })
})
