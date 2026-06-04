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

/** 트리에서 id 노드 찾기(공유 트리에서 서브트리 루트 조회용). */
export function findNode(nodes: UserGroupNode[], id: number): UserGroupNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findNode(n.children, id)
    if (found) return found
  }
  return null
}
