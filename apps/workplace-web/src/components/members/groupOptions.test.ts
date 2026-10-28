// 사람·조직 고르기 창의 그룹 목록(WP-1023, WP-1052 에서 공통으로 옮김) — 트리 평면화·검색어 거르기.
import { describe, expect, it } from 'vitest'

import type { UserGroupNode } from '../../types/userGroup'
import { filterGroupOptions, flattenGroupTree } from './groupOptions'

describe('그룹 목록 평면화·거르기', () => {
  const g = (id: number, name: string, children: UserGroupNode[] = []): UserGroupNode => ({
    id, code: null, name, parentId: null, ownerId: null, visibility: 'SHARED', sortOrder: 0, children,
  })
  const tree = [g(1, '본부', [g(2, '개발팀', [g(3, 'Backend')]), g(4, '디자인팀')]), g(5, '영업팀')]

  it('그룹 트리를 위에서 아래 순서로 펴고 상위 이름을 경로로 붙인다', () => {
    expect(flattenGroupTree(tree)).toEqual([
      { id: 1, name: '본부', path: '', ancestorIds: [], subtreeIds: [1, 2, 3, 4] },
      { id: 2, name: '개발팀', path: '본부', ancestorIds: [1], subtreeIds: [2, 3] },
      { id: 3, name: 'Backend', path: '본부 › 개발팀', ancestorIds: [1, 2], subtreeIds: [3] },
      { id: 4, name: '디자인팀', path: '본부', ancestorIds: [1], subtreeIds: [4] },
      { id: 5, name: '영업팀', path: '', ancestorIds: [], subtreeIds: [5] },
    ])
  })

  it('검색어는 이름이나 상위 경로에서 대소문자 없이 찾고, 빈 검색어면 모두', () => {
    const all = flattenGroupTree(tree)
    expect(filterGroupOptions(all, '개발').map((o) => o.id)).toEqual([2, 3])
    expect(filterGroupOptions(all, 'backend').map((o) => o.id)).toEqual([3])
    expect(filterGroupOptions(all, '  ')).toHaveLength(5)
  })
})
