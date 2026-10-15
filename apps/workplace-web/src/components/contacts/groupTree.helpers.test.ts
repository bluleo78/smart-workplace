// 그룹 트리 보조 함수 단위 테스트(WP-412) — 이전 E2E contacts/user-groups(상위 그룹 후보에서 자손 제외 #694)·
// contacts/contacts(비정수 group 파라미터)를 대체한다.
import { describe, expect, it } from 'vitest'

import type { UserGroupNode } from '@/types/userGroup'

import { collectDescendantIds, parentGroupOptions, parseGroupId } from './groupTree.helpers'

const node = (id: number, name: string, children: UserGroupNode[] = [], parentId: number | null = null): UserGroupNode => ({
  id, code: null, name, parentId, ownerId: null, visibility: 'SHARED', sortOrder: 0, children,
})

// 10(개발본부) > 11(하위팀) > 12(하위하위팀), 형제 15(디자인본부)
const grandchild = node(12, '하위하위팀', [], 11)
const child = node(11, '하위팀', [grandchild], 10)
const TREE = [node(10, '개발본부', [child]), node(15, '디자인본부')]

describe('collectDescendantIds / parentGroupOptions (#694)', () => {
  it('자손 id 는 손자까지 모으고 자기 자신은 뺀다', () => {
    expect([...collectDescendantIds(TREE[0])].sort()).toEqual([11, 12])
  })

  it('편집 대상의 자손만 후보에서 빠지고 형제·자기 자신은 남는다', () => {
    expect(parentGroupOptions(TREE, 10).map((o) => o.id)).toEqual([10, 15])
    expect(parentGroupOptions(TREE, 11).map((o) => o.id)).toEqual([10, 11, 15])
  })

  it('생성 모드(대상 없음)는 전체를 깊이만큼 들여써서', () => {
    expect(parentGroupOptions(TREE, null)).toEqual([
      { id: 10, name: '개발본부' },
      { id: 11, name: '　하위팀' },
      { id: 12, name: '　　하위하위팀' },
      { id: 15, name: '디자인본부' },
    ])
  })
})

describe('parseGroupId', () => {
  it('정수 문자열만 그룹 id 로, 비정수·빈 값은 null(일반 목록 유지)', () => {
    expect(parseGroupId('12')).toBe(12)
    expect(parseGroupId('abc')).toBeNull()
    expect(parseGroupId('1.5')).toBeNull()
    expect(parseGroupId('-1')).toBeNull()
    expect(parseGroupId('')).toBeNull()
    expect(parseGroupId(null)).toBeNull()
  })
})
