// 메일 받는사람에 조직·내 그룹 넣기(WP-1060) — 그룹 찾기·인원 수·주소 칩으로 풀기·안내 문구.
import { describe, expect, it } from 'vitest'

import type { UserGroupMemberHit } from '../types/userGroup'
import {
  expandGroupRecipients,
  groupExpansionToast,
  groupRecipients,
  matchRecipientGroups,
  type RecipientGroupOption,
} from './mailRecipientGroups'

/** 구성원 한 줄 — 기본은 주소가 있는 사람. */
function hit(over: Partial<UserGroupMemberHit> & Pick<UserGroupMemberHit, 'targetId' | 'name'>): UserGroupMemberHit {
  return { targetType: 'MEMBER', email: null, title: null, organization: null, groupId: 1, groupPath: [], ...over }
}

function option(id: number, name: string, kind: RecipientGroupOption['kind'] = 'department'): RecipientGroupOption {
  return { id, name, kind, path: '', ancestorIds: [], subtreeIds: [id] }
}

describe('그룹 찾기', () => {
  it('이름에 조각이 든 그룹만, 이름이 조각으로 시작하는 그룹을 앞으로, limit 개까지', () => {
    const options = [option(1, '플랫폼개발팀'), option(2, '개발팀'), option(3, '디자인팀'), option(4, '개발 주간회의', 'personal')]
    expect(matchRecipientGroups(options, '개발', 10).map((o) => o.id)).toEqual([2, 4, 1])
    expect(matchRecipientGroups(options, '개발', 2).map((o) => o.id)).toEqual([2, 4])
    expect(matchRecipientGroups(options, '  ', 10)).toEqual([])
  })
})

describe('인원 수와 풀기', () => {
  const members = [
    hit({ targetId: 1, name: '김개발', email: 'kim@x.kr' }),
    hit({ targetId: 2, name: '이개발', email: 'LEE@x.kr' }),
    hit({ targetId: 3, name: '정AI', email: null }),
    hit({ targetType: 'EXTERNAL', targetId: 1, name: 'David', email: 'david@partner.com' }),
    // 같은 사람이 두 번 와도 한 명이다.
    hit({ targetId: 1, name: '김개발', email: 'kim@x.kr' }),
  ]

  // 줄의 인원 수는 서버(UserGroupService.countMembers)가 같은 규칙으로 센다(WP-1135) — 여기서는 풀기 대상 규칙을 지킨다.
  it('풀리는 사람은 같은 사람이 한 번이고 주소 없는 사람도 든다', () => {
    expect(groupRecipients(members)).toHaveLength(4)
    expect(groupRecipients(members).filter((m) => m.targetType === 'EXTERNAL')).toHaveLength(1)
  })

  it('이 칸에 이미 있는 주소(대소문자 무시)는 빼고, 주소 없는 사람은 넣지 않고 이름을 돌려준다 — 외부 연락처도 넣는다', () => {
    const result = expandGroupRecipients(members, new Set(['lee@x.kr']))
    expect(result.chips.map((c) => c.label)).toEqual(['김개발 <kim@x.kr>', 'David <david@partner.com>'])
    expect(result.skipped).toBe(1)
    expect(result.noAddress).toEqual(['정AI'])
    // 넣은 수 + 뺀 수 + 주소 없는 수 = 줄의 인원 수
    expect(result.chips.length + result.skipped + result.noAddress.length).toBe(groupRecipients(members).length)
  })

  it('그룹 안에서 주소가 겹치면 조용히 한 번만 넣는다 — 「이미 들어 있는」 수(skipped)에는 세지 않는다', () => {
    const dup = [hit({ targetId: 1, name: '김개발', email: 'kim@x.kr' }), hit({ targetType: 'EXTERNAL', targetId: 9, name: '김(외부)', email: 'KIM@x.kr' })]
    const result = expandGroupRecipients(dup, new Set())
    expect(result.chips.map((c) => c.label)).toEqual(['김개발 <kim@x.kr>'])
    expect(result.skipped).toBe(0)
    expect(groupExpansionToast('개발팀', result)).toBe('개발팀에서 1명을 넣었습니다.')
  })

  it('그룹 안에서 겹친 주소가 이 칸에 이미 있으면 한 번만 뺀 것으로 센다', () => {
    const dup = [hit({ targetId: 1, name: '김개발', email: 'kim@x.kr' }), hit({ targetType: 'EXTERNAL', targetId: 9, name: '김(외부)', email: 'kim@x.kr' })]
    const result = expandGroupRecipients(dup, new Set(['kim@x.kr']))
    expect(result.chips).toEqual([])
    expect(result.skipped).toBe(1)
  })
})

describe('안내 문구', () => {
  const chip = { label: 'a', text: 'a', key: 'a', ok: true }
  it('넣은 수·뺀 수·주소 없는 사람', () => {
    const ten = Array.from({ length: 10 }, () => chip)
    expect(groupExpansionToast('개발팀', { chips: ten, skipped: 1, noAddress: ['정AI'] })).toBe(
      '개발팀에서 10명을 넣었습니다. 이미 들어 있는 1명은 빼고, 메일 주소가 없는 1명(정AI)은 넣지 못했습니다.',
    )
    expect(groupExpansionToast('개발팀', { chips: [chip], skipped: 2, noAddress: [] })).toBe('개발팀에서 1명을 넣었습니다. 이미 들어 있는 2명은 뺐습니다.')
    expect(groupExpansionToast('개발팀', { chips: [chip], skipped: 0, noAddress: [] })).toBe('개발팀에서 1명을 넣었습니다.')
    expect(groupExpansionToast('개발팀', { chips: [chip], skipped: 0, noAddress: ['a', 'b', 'c', 'd'] })).toBe(
      '개발팀에서 1명을 넣었습니다. 메일 주소가 없는 4명은 넣지 못했습니다.',
    )
  })
  it('새로 넣을 주소가 없거나 구성원이 없을 때', () => {
    expect(groupExpansionToast('개발팀', { chips: [], skipped: 3, noAddress: [] })).toBe('개발팀에서 새로 넣을 주소가 없습니다. 이미 들어 있는 3명은 뺐습니다.')
    expect(groupExpansionToast('개발팀', { chips: [], skipped: 0, noAddress: [] })).toBe('개발팀에 넣을 구성원이 없습니다.')
  })
})
