import type { UserGroupNode } from '@/types/userGroup'

/** 선택한 공유 그룹의 하위 트리(읽기 전용, 이름만). */
export function OrgChartView({ node }: { node: UserGroupNode }) {
  return (
    <div data-testid="org-chart-view" className="rounded-md border p-3 text-sm">
      <OrgNode node={node} depth={0} />
    </div>
  )
}

function OrgNode({ node, depth }: { node: UserGroupNode; depth: number }) {
  return (
    <div style={{ paddingLeft: `${depth * 16}px` }}>
      <div className="py-0.5 font-medium">{node.name}</div>
      {node.children.map((c) => (
        <OrgNode key={c.id} node={c} depth={depth + 1} />
      ))}
    </div>
  )
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
