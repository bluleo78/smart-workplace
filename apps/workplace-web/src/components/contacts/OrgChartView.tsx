import { Pencil, Plus, Trash2 } from 'lucide-react'

import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu'
import { Button } from '@/components/ui/button'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
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
  // WP-237: 터치 기기(hover 없음)에선 hover 아이콘 묶음 대신 ⋯ 하나로 모은다. 마우스 데스크톱은 기존 hover 아이콘 그대로.
  const coarse = useIsCoarsePointer()
  return (
    <div>
      <div
        // coarse 에선 행을 44px 로 키워 ⋯ 탭 영역이 이웃 행과 겹치지 않게 한다.
        className="group flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-muted/50 pointer-coarse:min-h-11"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        {editable && (coarse ? (
          <TouchRowActionsMenu
            title={node.name}
            testId={`org-more-${node.id}`}
            actions={[
              { key: 'org-add', label: '하위 그룹 추가', icon: <Plus />, onSelect: () => onAddChild?.(node) },
              { key: 'org-edit', label: '그룹 수정', icon: <Pencil />, onSelect: () => onEdit?.(node) },
              // 삭제는 기존 확인 다이얼로그(onDelete → 상위의 삭제 확인)를 그대로 거친다.
              { key: 'org-delete', label: '그룹 삭제', icon: <Trash2 />, destructive: true, onSelect: () => onDelete?.(node) },
            ]}
          />
        ) : (
          // 키보드 포커스(Tab)로 들어와도 보이게 group-kbd 를 함께 둔다(hover 만으론 키보드 경로가 없었다).
          <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-kbd:opacity-100">
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
        ))}
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
