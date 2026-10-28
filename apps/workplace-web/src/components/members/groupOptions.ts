// 사람·조직 고르기 창(PeopleAndDepartmentPicker)의 그룹 목록 — 그룹 트리를 평면 목록으로 펴고 검색어로 거른다.
// 노트 공유(WP-1023)에서 처음 썼고, 노트 스페이스 멤버 추가(WP-1052)도 같은 창을 쓰게 되어 공통 자리로 옮겼다.

import type { UserGroupNode } from '../../types/userGroup'

/**
 * 고르기 창에 보이는 그룹 한 줄(WP-1023).
 * path 는 상위 그룹 이름(「본부 › 개발팀」, 최상위면 빈 문자열), ancestorIds 는 위쪽 그룹 id(가까운 쪽이 뒤),
 * subtreeIds 는 자기와 모든 하위 그룹 id — 상위 부서가 이미 대상인지 보고(하위 부서 비활성), 내 그룹을 하위 그룹까지 펼칠 때 쓴다.
 */
export interface GroupOption {
  id: number
  name: string
  path: string
  ancestorIds: number[]
  subtreeIds: number[]
}

/** 그룹 트리를 검색용 평면 목록으로(WP-1023) — 트리 순서(정렬된 형제 순, 위에서 아래로)를 지키고 상위 이름을 경로로, 상위·하위 id 를 함께 붙인다. */
export function flattenGroupTree(nodes: UserGroupNode[], parentPath = '', ancestorIds: number[] = []): GroupOption[] {
  return nodes.flatMap((n) => {
    const below = flattenGroupTree(n.children ?? [], parentPath ? `${parentPath} › ${n.name}` : n.name, [...ancestorIds, n.id])
    // 하위 목록에서 바로 아래 자식들의 subtreeIds 를 모으면 이 그룹 아래 전체가 된다.
    const directChildren = below.filter((o) => o.ancestorIds.length === ancestorIds.length + 1)
    const subtreeIds = [n.id, ...directChildren.flatMap((c) => c.subtreeIds)]
    return [{ id: n.id, name: n.name, path: parentPath, ancestorIds, subtreeIds }, ...below]
  })
}

/** 검색어로 그룹을 거른다(WP-1023) — 이름이나 상위 경로에 검색어가 들어 있으면(대소문자 무시). 빈 검색어면 모두. */
export function filterGroupOptions(options: GroupOption[], query: string): GroupOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter((o) => o.name.toLowerCase().includes(q) || o.path.toLowerCase().includes(q))
}
