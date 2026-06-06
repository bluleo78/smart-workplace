// 그룹 트리 보조 함수 — 컴포넌트 파일에서 분리(react-refresh/only-export-components 준수).
import type { UserGroupNode } from '@/types/userGroup'

/** 트리를 평면 {id,name} 목록으로(부모 셀렉트 후보). depth 만큼 전각 공백 들여쓰기. */
export function flattenGroups(nodes: UserGroupNode[]): { id: number; name: string }[] {
  const out: { id: number; name: string }[] = []
  const walk = (ns: UserGroupNode[], depth: number) => {
    for (const n of ns) {
      out.push({ id: n.id, name: `${'　'.repeat(depth)}${n.name}` })
      walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

/**
 * URL `group` 파라미터를 유효 정수 그룹 ID 로 파싱(비정수는 null).
 * ContactsPage(그룹 뷰 렌더 판정)·ContactSidebar(검색·필터 잠금 판정)가 동일 기준을 쓰도록 공용화 —
 * 예전엔 사이드바가 검증 없이 Number() 만 써서 `?group=abc`(NaN)에 컨트롤만 잠기고 그룹 뷰는 안 뜨는 불일치가 있었다.
 */
export function parseGroupId(groupParam: string | null): number | null {
  return groupParam != null && /^\d+$/.test(groupParam) ? Number(groupParam) : null
}

/** 트리에서 id 노드 찾기(공유 트리에서 서브트리 루트 조회용). */
export function findNode(nodes: UserGroupNode[], id: number): UserGroupNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findNode(n.children, id)
    if (found) return found
  }
  return null
}
