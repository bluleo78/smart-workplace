// 사이드바 그룹 트리: 공유 조직도(읽기전용) + 개인 그룹(편집 가능).
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { userGroupsApi } from '@/api/userGroups'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useDeleteUserGroup } from '@/hooks/queries/useUserGroupMutations'
import { useUserGroups } from '@/hooks/queries/useUserGroups'
import { cn } from '@/lib/utils'
import type { UserGroupDetail, UserGroupNode } from '@/types/userGroup'

import { GroupForm } from './GroupForm'
import { findNode, flattenGroups } from './groupTree.helpers'

interface NodeProps {
  node: UserGroupNode
  depth: number
  selectedId: number | null
  onSelect: (id: number) => void
  editable: boolean
  onEdit?: (node: UserGroupNode) => void
  onDelete?: (node: UserGroupNode) => void
}

/** 트리 한 노드(재귀). editable=개인 그룹만 편집/삭제 버튼 노출. */
function TreeNode({ node, depth, selectedId, onSelect, editable, onEdit, onDelete }: NodeProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px]',
          selectedId === node.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <button
          type="button"
          className="shrink-0 text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? '접기' : '펼치기'}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="inline-block w-3.5" />
          )}
        </button>
        <button
          type="button"
          data-testid={`group-node-${node.id}`}
          onClick={() => onSelect(node.id)}
          className="min-w-0 flex-1 truncate text-left"
        >
          {node.name}
        </button>
        {editable && (
          <span className="hidden shrink-0 gap-1 group-hover:flex">
            <button
              type="button"
              data-testid={`group-edit-${node.id}`}
              onClick={() => onEdit?.(node)}
              aria-label="수정"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              data-testid={`group-delete-${node.id}`}
              onClick={() => onDelete?.(node)}
              aria-label="삭제"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </span>
        )}
      </div>
      {expanded &&
        node.children.map((c) => (
          <TreeNode
            key={c.id}
            node={c}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            editable={editable}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
    </div>
  )
}

interface Props {
  selectedId: number | null
  onSelect: (id: number | null) => void
}

/** 사이드바 그룹 영역: 조직도(공유, 읽기전용) + 내 그룹(개인, 편집). */
export function GroupTree({ selectedId, onSelect }: Props) {
  const { data, isLoading } = useUserGroups()
  const del = useDeleteUserGroup()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserGroupDetail | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserGroupNode | null>(null)

  const personalOptions = flattenGroups(data?.personal ?? [])

  // 같은 노드를 다시 클릭하면 선택 해제(통합 목록 복원).
  const handleSelect = (id: number) => onSelect(selectedId === id ? null : id)

  // 편집은 직속 멤버가 필요 → 상세를 가져와 폼에 전달
  const openEdit = async (node: UserGroupNode) => {
    try {
      const detail = await userGroupsApi.detail(node.id).then((r) => r.data)
      setEditTarget(detail)
      setFormOpen(true)
    } catch {
      toast.error('그룹 정보를 불러오지 못했습니다')
    }
  }
  const openCreate = () => {
    setEditTarget(null)
    setFormOpen(true)
  }
  const confirmDelete = async () => {
    if (!deleteTarget) return
    await del.mutateAsync(deleteTarget.id)
    // 삭제된 서브트리(자신 또는 자손)가 선택돼 있으면 선택 해제 — 캐스케이드로 사라진 그룹 뷰 방지.
    if (selectedId != null && findNode([deleteTarget], selectedId)) onSelect(null)
    setDeleteTarget(null)
  }

  return (
    <div className="mt-6 space-y-3">
      {/* 공유 조직도 — 읽기 전용 */}
      <div>
        <div className="px-3 pb-1 text-xs font-semibold text-muted-foreground/70">조직도</div>
        {isLoading ? (
          <div className="px-3 py-1 text-xs text-muted-foreground/60">불러오는 중…</div>
        ) : (data?.shared.length ?? 0) === 0 ? (
          <div className="px-3 py-1 text-xs text-muted-foreground/60">조직도가 없습니다</div>
        ) : (
          data?.shared.map((n) => (
            <TreeNode
              key={n.id}
              node={n}
              depth={0}
              selectedId={selectedId}
              onSelect={handleSelect}
              editable={false}
            />
          ))
        )}
      </div>

      {/* 내 그룹 — 개인, 편집 가능 */}
      <div>
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-xs font-semibold text-muted-foreground/70">내 그룹</span>
          <button
            type="button"
            data-testid="group-create"
            onClick={openCreate}
            aria-label="새 그룹"
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {(data?.personal.length ?? 0) === 0 ? (
          <div className="px-3 py-1 text-xs text-muted-foreground/60">그룹이 없습니다</div>
        ) : (
          data?.personal.map((n) => (
            <TreeNode
              key={n.id}
              node={n}
              depth={0}
              selectedId={selectedId}
              onSelect={handleSelect}
              editable
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ))
        )}
      </div>

      <GroupForm
        open={formOpen}
        onOpenChange={setFormOpen}
        group={editTarget}
        personalOptions={personalOptions}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="group-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>그룹 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" 그룹과 모든 하위 그룹·멤버십이 함께 삭제됩니다. 계속할까요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            {/* 파괴적 작업임을 시각적으로 표시 */}
            <AlertDialogAction variant="destructive" data-testid="group-delete-confirm-btn" onClick={confirmDelete}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
