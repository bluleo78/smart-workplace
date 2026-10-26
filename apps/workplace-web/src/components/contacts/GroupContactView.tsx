import { Search } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import type { ContactSelection } from '@/hooks/queries/useContactDetail'
import { useUserGroupDetail } from '@/hooks/queries/useUserGroupDetail'
import { useDeleteUserGroup } from '@/hooks/queries/useUserGroupMutations'
import { useUserGroups } from '@/hooks/queries/useUserGroups'
import { useAuth } from '@/hooks/useAuth'
import { SELECTED_SURFACE_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import type { UserGroupDetail, UserGroupNode } from '@/types/userGroup'

import { GroupForm } from './GroupForm'
import { filterGroupMembers, findNode, parentGroupOptions } from './groupTree.helpers'
import { OrgChartView } from './OrgChartView'

interface Props {
  groupId: number
  selected: ContactSelection | null
  onSelect: (sel: ContactSelection) => void
  /** 현재 보고 있는 그룹(또는 그 조상)이 삭제됐을 때 상위에서 선택 해제. */
  onGroupDeleted?: () => void
  /** 헤더 검색어(URL q). 있으면 이 그룹 직속 구성원 안에서만 거른다(WP-976, §B-1 「범위」). */
  search?: string
  /** 「전체에서 찾기」 — 그룹 범위를 풀고 같은 검색어로 전체 연락처를 찾는다(범위 칩 × 와 같은 동작). */
  onSearchAll?: () => void
}

/** 그룹 선택 시 우측 뷰. 공유=조직도 서브트리+직속 멤버, 개인=직속 멤버 목록. */
export function GroupContactView({ groupId, selected, onSelect, onGroupDeleted, search = '', onSearchAll }: Props) {
  const { data: detail, isLoading, isError } = useUserGroupDetail(groupId)
  const { data: tree } = useUserGroups()
  const { isAdmin } = useAuth()
  const del = useDeleteUserGroup()

  // 그룹 폼 열림 상태 및 편집/생성 대상
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserGroupDetail | null>(null)
  const [createParentId, setCreateParentId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserGroupNode | null>(null)

  // 노드 수정: 직속 멤버가 필요 → 상세를 가져와 폼에 전달
  const openEdit = async (node: UserGroupNode) => {
    try {
      const d = await userGroupsApi.detail(node.id).then((r) => r.data)
      setEditTarget(d)
      setCreateParentId(null)
      setFormOpen(true)
    } catch {
      toast.error('그룹 정보를 불러오지 못했습니다')
    }
  }
  // 하위 그룹 추가: 생성 모드 + 부모 프리필
  const openAddChild = (node: UserGroupNode) => {
    setEditTarget(null)
    setCreateParentId(node.id)
    setFormOpen(true)
  }
  // 삭제 확정: 캐스케이드는 백엔드. 보던 그룹(또는 조상) 삭제 시 선택 해제.
  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await del.mutateAsync(deleteTarget.id)
      // 보던 그룹(또는 조상) 삭제 시 선택 해제
      if (findNode([deleteTarget], groupId)) onGroupDeleted?.()
      setDeleteTarget(null)
    } catch {
      // 삭제 실패 — 다이얼로그만 닫음(에러 토스트는 useDeleteUserGroup.onError 가 이미 처리)
      setDeleteTarget(null)
    }
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  if (isError || !detail)
    return <div className="p-6 text-sm text-destructive">그룹을 불러오지 못했습니다</div>

  const sharedSubtree =
    detail.visibility === 'SHARED' && tree ? findNode(tree.shared, groupId) : null
  // 검색 중이면 그 그룹 구성원 안에서 거른 결과만 보인다 — 조직도 카드는 결과를 밀어내므로 검색 동안 숨긴다(WP-976 결정).
  const searching = search.trim() !== ''
  const members = searching ? filterGroupMembers(detail.members, search) : detail.members

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="group-contact-view">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-sm font-medium">{detail.name}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {detail.visibility === 'SHARED' ? '조직도' : '내 그룹'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {sharedSubtree && !searching && (
          <div className="mb-4">
            <OrgChartView
              node={sharedSubtree}
              editable={isAdmin}
              onEdit={openEdit}
              onAddChild={openAddChild}
              onDelete={setDeleteTarget}
            />
          </div>
        )}
        <div className="text-xs font-semibold text-muted-foreground">
          {searching ? `소속 멤버 중 검색 결과 ${members.length}명` : '소속 멤버'}
        </div>
        {members.length === 0 ? (
          <div data-testid="group-members-empty" className="py-4 text-sm text-muted-foreground">
            {searching ? `소속 멤버 중 「${search.trim()}」 검색 결과가 없습니다` : '소속 멤버가 없습니다'}
          </div>
        ) : (
          <div className="mt-2 divide-y rounded-md border">
            {members.map((m) => {
              const active = selected?.type === m.targetType && selected?.id === m.targetId
              return (
                <button
                  key={`${m.targetType}-${m.targetId}`}
                  type="button"
                  data-testid={`group-member-${m.targetType}-${m.targetId}`}
                  aria-pressed={active}
                  onClick={() => onSelect({ type: m.targetType, id: m.targetId })}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left',
                    // ContactsPage 연락처 행과 같은 규칙 — 보조 줄이 굵어지지 않게 막대+배경만.
                    active ? SELECTED_SURFACE_CLASS : 'hover:bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                      m.targetType === 'MEMBER'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {m.targetType === 'MEMBER' ? '멤버' : '외부'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.email || m.organization || m.title || ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {/* 검색 결과 아래 범위 해제 — 그룹 밖에 있는 사람을 찾으려면 같은 검색어로 전체에서 다시 찾는다(§B-1 「범위」). */}
        {searching && onSearchAll && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="group-search-all"
            onClick={onSearchAll}
            className="mt-3 text-muted-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            전체에서 「{search.trim()}」 찾기
          </Button>
        )}
      </div>
      {/* SHARED 그룹 편집 폼 — admin 전용 */}
      {isAdmin && (
        <GroupForm
          open={formOpen}
          onOpenChange={setFormOpen}
          group={editTarget}
          visibility="SHARED"
          // 편집 대상의 자손 그룹은 상위 그룹 후보에서 제외 — 선택 시 백엔드가 항상 400(사이클) 거부.
          parentOptions={parentGroupOptions(tree?.shared ?? [], editTarget?.id ?? null)}
          defaultParentId={createParentId}
        />
      )}
      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="org-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>그룹 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; 그룹과 모든 하위 그룹·멤버십이 함께 삭제됩니다. 계속할까요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="org-delete-confirm-btn" onClick={confirmDelete}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
