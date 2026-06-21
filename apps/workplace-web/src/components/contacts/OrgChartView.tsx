import { Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { UserGroupNode } from '@/types/userGroup'

interface OrgChartProps {
  node: UserGroupNode
  /** true 면 노드 호버 시 하위추가/수정/삭제 액션 노출(ADMIN 전용). */
  editable?: boolean
  onEdit?: (node: UserGroupNode) => void
  onAddChild?: (node: UserGroupNode) => void
  onDelete?: (node: UserGroupNode) => void
}

/** 선택한 공유 그룹의 하위 트리. editable 이면 인라인 편집 액션 노출. */
export function OrgChartView({ node, editable = false, onEdit, onAddChild, onDelete }: OrgChartProps) {
  return (
    <div data-testid="org-chart-view" className="rounded-md border p-3 text-sm">
      <OrgNode
        node={node}
        depth={0}
        editable={editable}
        onEdit={onEdit}
        onAddChild={onAddChild}
        onDelete={onDelete}
      />
    </div>
  )
}

interface OrgNodeProps extends Omit<OrgChartProps, 'node'> {
  node: UserGroupNode
  depth: number
}

/** 조직도 한 노드(재귀). editable 이면 호버 액션(하위추가/수정/삭제). */
function OrgNode({ node, depth, editable, onEdit, onAddChild, onDelete }: OrgNodeProps) {
  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        {editable && (
          <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid={`org-add-${node.id}`}
              aria-label="하위 그룹 추가"
              onClick={() => onAddChild?.(node)}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid={`org-edit-${node.id}`}
              aria-label="그룹 수정"
              onClick={() => onEdit?.(node)}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              data-testid={`org-delete-${node.id}`}
              aria-label="그룹 삭제"
              onClick={() => onDelete?.(node)}
            >
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
      {node.children.map((c) => (
        <OrgNode
          key={c.id}
          node={c}
          depth={depth + 1}
          editable={editable}
          onEdit={onEdit}
          onAddChild={onAddChild}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
