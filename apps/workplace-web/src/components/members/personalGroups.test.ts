// 내 그룹을 사람으로 펼치기(WP-1023 → WP-1056 공통화) — 중복 빼기·더한 수·안내 문구.
import { describe, expect, it, vi } from 'vitest'

import type { UserGroupMemberHit } from '../../types/userGroup'
import { addGroupMembers, addMembersFromGroup, groupExpansionMessage, planGroupExpansion } from './personalGroups'

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

  it('부서로 있다 직접 멤버로 고정된 사람은 새로 들어온 사람과 나눠 알린다(WP-1186)', () => {
    expect(groupExpansionMessage('개발 스터디', 3, 1, 1)).toBe(
      '개발 스터디에서 2명 추가 · 부서로 있던 1명은 직접 멤버로 고정 (이미 있는 1명 제외)',
    )
    expect(groupExpansionMessage('개발 스터디', 2, 0, 2)).toBe('개발 스터디에서 부서로 있던 2명은 직접 멤버로 고정')
    // 고정 수가 더한 수보다 크게 와도 더한 수를 넘겨 말하지 않는다.
    expect(groupExpansionMessage('개발 스터디', 1, 0, 2)).toBe('개발 스터디에서 부서로 있던 1명은 직접 멤버로 고정')
  })
})

describe('addMembersFromGroup — 직접 멤버로 고정된 수(WP-1186)', () => {
  it('부서로 있던 사람 중 실제로 더해진 사람만 pinned 로 센다(실패한 사람은 빼고)', async () => {
    const invalidate = vi.fn()
    const result = await addMembersFromGroup([3, 5, 6, 8], {
      readCurrentIds: async () => ({ ids: [3], pinnable: [5, 6] }),
      addOne: async (id) => {
        if (id === 6) throw new Error('fail')
      },
      invalidate,
    })
    expect(result).toEqual({ added: 2, skipped: 1, failed: 1, pinned: 1 })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('지금 멤버를 id 목록으로만 주면(드라이브 공간) pinned 는 0', async () => {
    const result = await addMembersFromGroup([4], { readCurrentIds: async () => [], addOne: async () => {}, invalidate: () => {} })
    expect(result).toEqual({ added: 1, skipped: 0, failed: 0, pinned: 0 })
  })
})

/** 구성원 찾기 응답 한 줄 — 사람(MEMBER) 기본. */
function hit(targetId: number, name: string, targetType: 'MEMBER' | 'EXTERNAL' = 'MEMBER'): UserGroupMemberHit {
  return { targetType, targetId, name, email: null, title: null, organization: null, groupId: 10, groupPath: [] }
}

describe('planGroupExpansion — 그룹을 고르는 시점의 사람으로 풀기(WP-1059)', () => {
  it('이미 있는 참석자·나·외부 연락처는 빼고, 남은 사람을 이름과 함께 넣는다', () => {
    const plan = planGroupExpansion(
      [hit(1, '나'), hit(2, '홍길동'), hit(3, '김민수'), hit(4, '이서연'), hit(500, '외부 손님', 'EXTERNAL')],
      [2],
      1,
      500,
    )
    expect(plan.toAdd).toEqual([
      { id: 3, name: '김민수' },
      { id: 4, name: '이서연' },
    ])
    expect(plan.skipped).toBe(1)
    expect(plan.meIncluded).toBe(true)
  })

  it('같은 사람이 두 하위 조직에 있어도 한 번만 넣는다', () => {
    const plan = planGroupExpansion([hit(3, '김민수'), hit(3, '김민수')], [], 1, 500)
    expect(plan.toAdd).toEqual([{ id: 3, name: '김민수' }])
  })
})
