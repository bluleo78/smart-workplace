// 사이드바 그룹 트리: 공유 조직도 + 개인 그룹. 그룹 관리(하위 추가·수정·삭제)는 모두 이 트리 행의 ⋯ 메뉴에서 한다(WP-978).
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { userGroupsApi } from '@/api/userGroups'
import { ActionMenuItems } from '@/components/ActionMenuItems'
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
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
import { useAuth } from '@/hooks/useAuth'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import type { UserGroupDetail, UserGroupNode, UserGroupVisibility } from '@/types/userGroup'

import { GroupForm } from './GroupForm'
import { findNode, parentGroupOptions } from './groupTree.helpers'

interface NodeProps {
  node: UserGroupNode
  depth: number
  selectedId: number | null
  onSelect: (id: number) => void
  /** 행 ⋯ 메뉴 항목. null 이면 ⋯ 를 두지 않는다(비관리자의 조직도 행). */
  actionsFor: (node: UserGroupNode) => MobileSheetAction[] | null
  /** ⋯ 트리거·메뉴 항목 testid 접두사 — 조직도 org, 내 그룹 group(`org-more-10`·`org-edit-10`). */
  testPrefix: 'org' | 'group'
}

/**
 * 데스크톱(마우스) 행 ⋯ — 평소엔 투명하고 행 hover·행 안 키보드 초점(group-kbd)·메뉴가 열린 동안 보인다(§B-1 「관리 동작」).
 * 늘 Tab 순서에 두고 폭 0·투명으로만 숨긴다(WP-844) — 안 보이는 동안은 눌리지 않게 pointer-events 를 끈다.
 * 평소 폭을 0 으로 두는 건 좁은 사이드바에서 긴 조직 이름이 ⋯ 자리 때문에 늘 더 잘리지 않게 하려는 것이다.
 * 메뉴 내용은 포털이라 마우스가 메뉴로 넘어가면 행 hover 가 풀린다 → 열린 동안(data-state=open)도 보이게 둔다.
 */
function DesktopRowMenu({ label, testId, actions, itemTestId }: {
  label: string
  testId: string
  actions: MobileSheetAction[]
  itemTestId: (key: string) => string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={`${label} 더보기`}
          className={cn(
            // 숨은 동안 -ml-1 로 행의 gap 까지 거둬 이름 폭을 ⋯ 없는 행과 같게 둔다.
            'pointer-events-none -ml-1 flex h-5 w-0 shrink-0 items-center justify-center overflow-hidden rounded text-muted-foreground opacity-0 outline-none hover:bg-accent hover:text-foreground',
            // 키보드 초점은 Button 과 같은 초점 링으로 보인다(행 안 초점이면 group-kbd 로 ⋯ 도 함께 드러난다).
            'focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'group-hover:pointer-events-auto group-hover:ml-0 group-hover:w-6 group-hover:opacity-100',
            'group-kbd:pointer-events-auto group-kbd:ml-0 group-kbd:w-6 group-kbd:opacity-100',
            'data-[state=open]:pointer-events-auto data-[state=open]:ml-0 data-[state=open]:w-6 data-[state=open]:opacity-100',
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <ActionMenuItems actions={actions} itemTestId={itemTestId} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 트리 한 노드(재귀). 관리 동작은 행 끝 ⋯ 하나로 모은다 — 마우스는 hover 드롭다운, 터치는 늘 보이는 ⋯(WP-978). */
function TreeNode({ node, depth, selectedId, onSelect, actionsFor, testPrefix }: NodeProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const coarse = useIsCoarsePointer()
  const actions = actionsFor(node)
  // 메뉴 항목 testid 는 `<키>-<그룹 id>` — 예: org-edit-10, group-delete-20.
  const itemTestId = (key: string) => `${key}-${node.id}`
  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm',
          // 터치에서 ⋯ 가 있는 행은 44px 로 키워 ⋯ 탭 영역이 이웃 행과 겹치지 않게 한다.
          actions && 'pointer-coarse:min-h-11 pointer-coarse:py-0',
          // 앞에 접기 chevron 버튼만 있고 항목 아이콘이 없어 행용(SELECTED_ROW_CLASS).
          selectedId === node.id ? SELECTED_ROW_CLASS : 'hover:bg-accent/50',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* 접기 버튼은 하위 그룹이 있을 때만 둔다(WP-923). 이름에 그룹 이름을 넣고 상태는 aria-expanded 로 전한다. */}
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
            aria-label={`${node.name} ${expanded ? '접기' : '펼치기'}`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="inline-block w-3.5 shrink-0" />
        )}
        <button
          type="button"
          data-testid={`group-node-${node.id}`}
          // 사이드바 「보기」 항목 — 누르면 그 그룹으로 이동하고 현재 위치를 aria-current 로 알린다(WP-976, §B-1).
          aria-current={selectedId === node.id ? 'page' : undefined}
          title={node.name}
          // 모바일 시트에서 그룹을 고르면 시트를 닫아 그 그룹 목록을 보여 준다(WP-578). ⋯ 와 그 메뉴 항목엔 달지 않는다 —
          // 관리 다이얼로그는 이 컴포넌트(시트) 안에 있어 시트를 닫으면 함께 사라진다.
          data-sheet-dismiss
          onClick={() => onSelect(node.id)}
          // 모바일(☰ 시트)에선 깊은 들여쓰기 + 늘 보이는 ⋯(44px)로 이름 폭이 좁아 말줄임 대신 줄바꿈한다(WP-978 시안).
          className="min-w-0 flex-1 truncate text-left max-lg:whitespace-normal max-lg:break-words max-lg:py-1"
        >
          {node.name}
        </button>
        {actions &&
          (coarse ? (
            <TouchRowActionsMenu
              title={node.name}
              testId={`${testPrefix}-more-${node.id}`}
              itemTestId={itemTestId}
              actions={actions}
            />
          ) : (
            <DesktopRowMenu
              label={node.name}
              testId={`${testPrefix}-more-${node.id}`}
              actions={actions}
              itemTestId={itemTestId}
            />
          ))}
      </div>
      {expanded &&
        node.children.map((c) => (
          <TreeNode
            key={c.id}
            node={c}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            actionsFor={actionsFor}
            testPrefix={testPrefix}
          />
        ))}
    </div>
  )
}

interface Props {
  selectedId: number | null
  onSelect: (id: number | null) => void
}

/** 사이드바 그룹 영역: 조직도(공유 — 관리는 ADMIN) + 내 그룹(개인). 관리 다이얼로그(폼·삭제 확인)를 함께 가진다. */
export function GroupTree({ selectedId, onSelect }: Props) {
  const { data, isLoading } = useUserGroups()
  const del = useDeleteUserGroup()
  const { isAdmin } = useAuth()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserGroupDetail | null>(null)
  // 삭제 대상은 확인창이 닫힌 뒤에도 남겨 둔다 — 닫히는 동안 문구(이름)·testid 가 비거나 바뀌지 않게 열림은 따로 둔다.
  const [deleteTarget, setDeleteTarget] = useState<UserGroupNode | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deletePrefix = deleteTarget?.visibility === 'SHARED' ? 'org' : 'group'
  // 확인창의 「삭제」를 눌렀는지·그 결과 — 확인창이 닫힐 때 초점을 어디로 돌릴지 정한다(아래 restoreFocusAfterDelete).
  // AlertDialogAction 은 누르는 즉시 창을 닫아 삭제 요청이 아직 끝나지 않았을 수도 있다(pending).
  const deleteResultRef = useRef<'idle' | 'pending' | 'done' | 'failed'>('idle')
  // 폼이 다루는 그룹 종류 — 생성은 어느 ＋/「하위 조직 추가」를 눌렀는지, 수정은 대상 그룹의 종류로 정한다.
  const [formVisibility, setFormVisibility] = useState<UserGroupVisibility>('PERSONAL')
  // 「하위 조직 추가」로 열면 상위 그룹을 미리 채운다. 헤더 ＋(최상위 생성)·수정에선 비운다.
  const [createParentId, setCreateParentId] = useState<number | null>(null)

  // 상위 그룹 후보 — 폼의 그룹 종류와 같은 트리에서, 수정 대상의 자손은 뺀다(고르면 백엔드가 사이클로 400).
  const parentOptions = parentGroupOptions(
    (formVisibility === 'SHARED' ? data?.shared : data?.personal) ?? [],
    editTarget?.id ?? null,
  )

  // 누르면 그 그룹으로 이동만 한다 — 같은 노드를 다시 눌러도 해제하지 않는다(WP-976, §B-1 「사이드바 선택」).
  const handleSelect = (id: number) => onSelect(id)

  // 수정은 직속 멤버가 필요 → 상세를 가져와 폼에 전달
  const openEdit = async (node: UserGroupNode) => {
    try {
      const detail = await userGroupsApi.detail(node.id).then((r) => r.data)
      setEditTarget(detail)
      setFormVisibility(node.visibility)
      setCreateParentId(null)
      setFormOpen(true)
    } catch {
      toast.error('그룹 정보를 불러오지 못했습니다')
    }
  }
  const openCreate = (visibility: UserGroupVisibility, parentId: number | null = null) => {
    setFormVisibility(visibility)
    setEditTarget(null)
    setCreateParentId(parentId)
    setFormOpen(true)
  }
  const confirmDelete = async () => {
    if (!deleteTarget) return
    deleteResultRef.current = 'pending'
    try {
      await del.mutateAsync(deleteTarget.id)
      deleteResultRef.current = 'done'
      // 삭제된 서브트리(자신 또는 자손)를 보고 있었다면 그룹 보기를 푼다 — 캐스케이드로 사라진 그룹 뷰 방지.
      if (selectedId != null && findNode([deleteTarget], selectedId)) onSelect(null)
    } catch {
      deleteResultRef.current = 'failed'
      // 에러 토스트는 useDeleteUserGroup.onError 가 이미 띄운다. 확인창은 AlertDialogAction 이 이미 닫았다.
    }
  }

  /**
   * 삭제 확인창이 닫힐 때 초점 처리. 삭제하면 ⋯ 트리거가 있던 행이 사라져 Radix 기본 복귀가 body 로 떨어진다 —
   * 키보드 사용자가 처음부터 Tab 해야 한다(WP-844). 그래서 삭제를 눌렀다면(요청 중이거나 성공) 기본 복귀를 막고
   * 남는 요소로 옮긴다: 부모 노드 버튼, 최상위였다면 그 섹션 머리 ＋. 취소·실패면 트리거가 남아 있으니 기본 복귀를 둔다.
   * 부모 id 는 삭제 대상 노드가 들고 있어, 트리가 이미 다시 받아져 대상이 사라졌어도 찾을 수 있다.
   */
  const restoreFocusAfterDelete = (e: Event) => {
    const result = deleteResultRef.current
    deleteResultRef.current = 'idle'
    if (!deleteTarget || (result !== 'pending' && result !== 'done')) return
    e.preventDefault()
    const testId = deleteTarget.parentId != null ? `group-node-${deleteTarget.parentId}` : `${deletePrefix}-create`
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus()
  }

  // 메뉴 항목이 다이얼로그를 바로 열면 닫히는 메뉴의 포커스 복귀·pointer-events 정리와 겹친다 — 한 틱 미룬다(WikiTreeRow 와 같은 규칙).
  // 수정은 상세 조회를 기다리므로 저절로 미뤄진다.
  const later = (fn: () => void) => () => setTimeout(fn, 0)
  // 삭제는 확인창을 거친다(하위 그룹·멤버십 캐스케이드).
  const askDelete = (node: UserGroupNode) =>
    later(() => {
      setDeleteTarget(node)
      setDeleteOpen(true)
    })

  // 조직도 행 ⋯ — ADMIN 만. 비관리자는 ⋯ 자체가 없다(읽기 전용).
  const orgActions = (node: UserGroupNode): MobileSheetAction[] | null =>
    isAdmin
      ? [
          { key: 'org-add', label: '하위 조직 추가', icon: <Plus />, onSelect: later(() => openCreate('SHARED', node.id)) },
          { key: 'org-edit', label: '수정', icon: <Pencil />, onSelect: () => void openEdit(node) },
          { key: 'org-delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: askDelete(node) },
        ]
      : null
  // 내 그룹 행 ⋯ — 본인 그룹이라 누구나.
  const personalActions = (node: UserGroupNode): MobileSheetAction[] => [
    { key: 'group-edit', label: '수정', icon: <Pencil />, onSelect: () => void openEdit(node) },
    { key: 'group-delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: askDelete(node) },
  ]

  return (
    <div className="mt-6 space-y-3">
      {/* 공유 조직도 — 관리(추가·수정·삭제)는 ADMIN 만 */}
      <div>
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-xs font-semibold text-muted-foreground">조직도</span>
          {isAdmin && (
            <button
              type="button"
              data-testid="org-create"
              onClick={() => openCreate('SHARED')}
              aria-label="새 조직 그룹"
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {isLoading ? (
          <div className="px-3 py-1 text-xs text-muted-foreground">불러오는 중…</div>
        ) : (data?.shared.length ?? 0) === 0 ? (
          <div className="px-3 py-1 text-xs text-muted-foreground">조직도가 없습니다</div>
        ) : (
          data?.shared.map((n) => (
            <TreeNode
              key={n.id}
              node={n}
              depth={0}
              selectedId={selectedId}
              onSelect={handleSelect}
              actionsFor={orgActions}
              testPrefix="org"
            />
          ))
        )}
      </div>

      {/* 내 그룹 — 개인, 본인이 관리 */}
      <div>
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-xs font-semibold text-muted-foreground">내 그룹</span>
          <button
            type="button"
            data-testid="group-create"
            onClick={() => openCreate('PERSONAL')}
            aria-label="새 그룹"
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {(data?.personal.length ?? 0) === 0 ? (
          <div className="px-3 py-1 text-xs text-muted-foreground">그룹이 없습니다</div>
        ) : (
          data?.personal.map((n) => (
            <TreeNode
              key={n.id}
              node={n}
              depth={0}
              selectedId={selectedId}
              onSelect={handleSelect}
              actionsFor={personalActions}
              testPrefix="group"
            />
          ))
        )}
      </div>

      <GroupForm
        open={formOpen}
        onOpenChange={setFormOpen}
        group={editTarget}
        visibility={formVisibility}
        parentOptions={parentOptions}
        defaultParentId={createParentId}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        {/* testid 는 조직도/내 그룹을 나눠 둔다 — 예전 두 화면(그룹 보기·사이드바)의 확인창 이름을 그대로 잇는다. */}
        <AlertDialogContent data-testid={`${deletePrefix}-delete-confirm`} onCloseAutoFocus={restoreFocusAfterDelete}>
          <AlertDialogHeader>
            <AlertDialogTitle>그룹 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" 그룹과 모든 하위 그룹·멤버십이 함께 삭제됩니다. 계속할까요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            {/* 파괴적 작업임을 시각적으로 표시 */}
            <AlertDialogAction
              variant="destructive"
              data-testid={`${deletePrefix}-delete-confirm-btn`}
              onClick={confirmDelete}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
