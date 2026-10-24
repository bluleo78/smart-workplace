// 프로젝트 설정 「상태」 섹션(WP-809) — 범주 4블록(할 일·진행 중·완료·취소, 순서 고정)마다 상태 목록과 「+ 추가」.
// OWNER(비 개인 프로젝트)는 추가·편집·끌기/위아래 이동·삭제, 멤버는 읽기 전용 목록을 본다(서버 assertEditable 과 같은 규칙).
// 순서는 같은 범주 안에서만 바뀐다 — 범주마다 SortableContext 를 따로 두고, 다른 범주 위에 놓으면 무시한다.
// 낙관적 순서 갱신·실패 롤백·토스트는 useReorderProjectStatuses 가 맡는다.
import {
  type Announcements,
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { CATEGORY_COLOR } from '@/components/issues/issueCategoryColor'
import { SettingsSection } from '@/components/layout/SettingsSection'
import { Button } from '@/components/ui/button'
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  NO_STATUSES,
  useProjectStatuses,
  useReorderProjectStatuses,
  useStatusIssueCounts,
  useUpdateProjectStatus,
} from '@/hooks/queries/useProjectStatuses'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ISSUE_STATUS_LABEL, ISSUE_STATUSES } from '@/lib/issueGrouping'
import {
  CATEGORY_DEFAULT_COLOR,
  isDefaultStatus,
  isLastInCategory,
  moveWithinCategory,
  reorderWithinCategory,
  STATUS_NAME_MAX,
  statusAddBlockedReason,
  statusesByCategory,
} from '@/lib/projectStatuses'
import { cn } from '@/lib/utils'
import type { IssueStatus } from '@/types/issue'
import type { ProjectStatus } from '@/types/projectStatus'

import { ProjectMetaEditDialog } from '../ProjectMetaEditDialog'
import { ProjectStatusesGate } from '../ProjectStatusesGate'
import { MobileStatusRowSheet } from './MobileStatusRowSheet'
import { StatusAddForm } from './StatusAddForm'
import { StatusDeleteDialog } from './StatusDeleteDialog'
import { DEFAULT_BADGE_TOOLTIP, StatusRow, type StatusRowActions } from './StatusRow'

/** 섹션 설명 — Global Constraints 고정 문구. */
const DESCRIPTION = '보드 컬럼과 이슈 상태에 쓰여요. 범주는 진행률·완료 처리 기준이에요. 순서는 같은 범주 안에서만 바꿀 수 있어요.'

/** 손잡이 스크린리더 사용법(dnd-kit 기본 영어 문구 대체). */
const SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Space 키로 상태를 집고, 위아래 방향키로 같은 범주 안 자리를 고른 뒤 Space 키로 놓으세요. Esc 키를 누르면 취소됩니다.',
}

export function StatusManagement({ projectKey, canEdit }: { projectKey: string; canEdit: boolean }) {
  const statusesQuery = useProjectStatuses(projectKey)
  const statuses = statusesQuery.data ?? NO_STATUSES
  const counts = useStatusIssueCounts(projectKey)
  const reorder = useReorderProjectStatuses(projectKey)
  const update = useUpdateProjectStatus(projectKey)
  const isMobile = useIsMobile()
  const { hash } = useLocation()

  const [addingTo, setAddingTo] = useState<IssueStatus | null>(null)
  const [editTarget, setEditTarget] = useState<ProjectStatus | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectStatus | null>(null)
  const [sheetTarget, setSheetTarget] = useState<ProjectStatus | null>(null)

  const byCategory = useMemo(() => statusesByCategory(statuses), [statuses])
  const addBlocked = statusAddBlockedReason(statuses)

  // #statuses 로 들어오면(보드 「상태 관리」 등) 목록이 그려진 뒤 한 번만 섹션으로 스크롤 — 재조회마다 다시 끌어오지 않는다.
  const scrolledRef = useRef(false)
  useEffect(() => {
    if (scrolledRef.current || !statusesQuery.data || hash !== '#statuses') return
    scrolledRef.current = true
    document.getElementById('statuses')?.scrollIntoView({ block: 'start' })
  }, [statusesQuery.data, hash])

  // 한 범주의 새 id 순서를 저장 — 이미 그 순서면 보내지 않는다.
  function saveOrder(category: IssueStatus, ids: number[]) {
    const current = byCategory[category].map((s) => s.id)
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) return
    reorder.mutate({ category, statusIds: ids })
  }

  /** 행 액션 — 위/아래는 범주 경계면 null, 삭제는 범주의 마지막 상태면 null. */
  function actionsFor(s: ProjectStatus): StatusRowActions {
    const up = moveWithinCategory(statuses, s.id, -1)
    const down = moveWithinCategory(statuses, s.id, 1)
    return {
      onEdit: () => setEditTarget(s),
      onMoveUp: up && (() => saveOrder(s.category, up)),
      onMoveDown: down && (() => saveOrder(s.category, down)),
      onDelete: isLastInCategory(statuses, s) ? null : () => setDeleteTarget(s),
    }
  }

  // 끌기 — 손잡이에서만 시작(distance 8 로 클릭과 구분), 키보드는 Space 집기 → 방향키 → Space 놓기.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // 충돌 판정 — 포인터 끌기는 포인터가 실제로 올라간 행만(pointerWithin; 전체 closestCenter 는 다른 범주 위에 놓아도 내 범주 끝 행을 잡는다).
  // 키보드 끌기는 포인터 좌표가 없어 pointerWithin 이 늘 빈 결과라 놓을 수 없으므로 같은 범주 행만 후보로 closestCenter.
  const collisionDetection: CollisionDetection = (args) => {
    if (args.pointerCoordinates) return pointerWithin(args)
    const category = statuses.find((s) => s.id === args.active.id)?.category
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => statuses.find((s) => s.id === c.id)?.category === category,
      ),
    })
  }
  // 놓기 — 다른 범주 행이거나 순서가 그대로면 무시해 범주 밖으로 옮기지 않는다.
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || over.id === active.id) return
    const from = statuses.find((s) => s.id === active.id)
    const to = statuses.find((s) => s.id === over.id)
    if (!from || !to || from.category !== to.category) return
    saveOrder(from.category, reorderWithinCategory(statuses, from.category, from.id, to.id))
  }
  const accessibility = useMemo(() => {
    const nameOf = (id: string | number) => statuses.find((s) => s.id === id)?.name ?? '상태'
    const positionOf = (id: string | number) => {
      const s = statuses.find((x) => x.id === id)
      return s ? byCategory[s.category].findIndex((x) => x.id === id) + 1 : 0
    }
    const announcements: Announcements = {
      onDragStart: ({ active }) => `${nameOf(active.id)} 상태를 집었습니다. 지금 ${positionOf(active.id)}번째 자리입니다.`,
      onDragOver: ({ active, over }) => {
        if (over?.id === active.id) return undefined
        return over
          ? `${nameOf(active.id)} 상태가 ${positionOf(over.id)}번째 자리 위에 있습니다.`
          : `${nameOf(active.id)} 상태가 놓을 자리 밖에 있습니다.`
      },
      onDragEnd: ({ active, over }) =>
        over && over.id !== active.id
          ? `${nameOf(active.id)} 상태를 놓았습니다.`
          : `${nameOf(active.id)} 상태를 놓았습니다. 순서는 그대로입니다.`,
      onDragCancel: ({ active }) => `${nameOf(active.id)} 상태 이동을 취소했습니다.`,
    }
    return { announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }
  }, [statuses, byCategory])

  const sheetActions = sheetTarget ? actionsFor(sheetTarget) : null

  return (
    <SettingsSection id="statuses" title="상태" description={DESCRIPTION} data-testid="settings-statuses">
      {/* 앱 루트에 툴팁 공급자가 없어 섹션이 직접 감싼다(「+ 추가」 상한·「기본」 툴팁). */}
      <TooltipProvider>
      {/* 목록을 못 받았으면 빈 범주에 「+ 추가」를 내밀지 않는다 — 보드·목록과 같은 관문(로딩·다시 시도). */}
      <ProjectStatusesGate
        projectKey={projectKey}
        description="잠시 후 다시 시도해 주세요."
        testId="settings-statuses-error"
        loadingClassName=""
        compact
      >
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragEnd={handleDragEnd}
          accessibility={accessibility}
        >
          <div className="space-y-5">
            {ISSUE_STATUSES.map((category) => (
              <div key={category} data-testid={`status-category-${category}`}>
                <div className={cn('flex min-h-8 items-center gap-2 border-b-2 pb-1', CATEGORY_COLOR[category].band)}>
                  <h3 className="text-sm font-semibold">{ISSUE_STATUS_LABEL[category]}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{byCategory[category].length}</span>
                  {canEdit && (
                    <AddButton
                      category={category}
                      blockedReason={addBlocked}
                      onClick={() => setAddingTo(category)}
                    />
                  )}
                </div>
                <SortableContext items={byCategory[category].map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <ul className="mt-2 space-y-1">
                    {byCategory[category].map((s) => (
                      <StatusRow
                        key={s.id}
                        status={s}
                        isDefault={isDefaultStatus(statuses, s)}
                        count={counts && (counts[s.id] ?? 0)}
                        canEdit={canEdit}
                        isMobile={isMobile}
                        actions={actionsFor(s)}
                        onOpenSheet={() => setSheetTarget(s)}
                      />
                    ))}
                  </ul>
                </SortableContext>
                {canEdit && addingTo === category && (
                  <StatusAddForm
                    projectKey={projectKey}
                    category={category}
                    statuses={statuses}
                    onDone={() => setAddingTo(null)}
                  />
                )}
              </div>
            ))}
          </div>
        </DndContext>
      </ProjectStatusesGate>
      </TooltipProvider>

      {/* 상한 안내 — 막힌 「+ 추가」의 툴팁은 터치에서 볼 수 없어 글로도 둔다. */}
      {canEdit && addBlocked && <p className="text-xs text-muted-foreground">{addBlocked}</p>}
      {/* 「기본」 툴팁은 터치에서 볼 수 없어 모바일은 뜻을 글로 둔다. */}
      {isMobile && <p className="text-xs text-muted-foreground">「기본」은 {DEFAULT_BADGE_TOOLTIP}</p>}

      <ProjectMetaEditDialog
        title="상태 편집"
        nameMaxLength={STATUS_NAME_MAX}
        target={
          editTarget && {
            id: editTarget.id,
            name: editTarget.name,
            colorToken: editTarget.color ?? CATEGORY_DEFAULT_COLOR[editTarget.category],
          }
        }
        onSave={(v) => update.mutateAsync({ id: editTarget!.id, body: { name: v.name, color: v.colorToken } })}
        onClose={() => setEditTarget(null)}
      />
      <StatusDeleteDialog
        projectKey={projectKey}
        status={deleteTarget}
        statuses={statuses}
        issueCount={deleteTarget && counts ? (counts[deleteTarget.id] ?? 0) : undefined}
        onClose={() => setDeleteTarget(null)}
      />
      {isMobile && <MobileStatusRowSheet status={sheetTarget} actions={sheetActions} onClose={() => setSheetTarget(null)} />}
    </SettingsSection>
  )
}

/** 범주 제목 오른쪽 「+ 추가」 — 상한이면(blockedReason) 막고, 막힌 버튼은 포인터·포커스를 받지 않아 감싼 칸이 툴팁을 띄운다. */
function AddButton({
  category,
  blockedReason,
  onClick,
}: {
  category: IssueStatus
  blockedReason: string | undefined
  onClick: () => void
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-primary hover:text-primary disabled:text-muted-foreground"
      data-testid={`status-add-${category}`}
      aria-label={`${ISSUE_STATUS_LABEL[category]} 범주에 상태 추가`}
      disabled={!!blockedReason}
      onClick={onClick}
    >
      <Plus className="h-3.5 w-3.5" />
      추가
    </Button>
  )
  if (!blockedReason) return <div className="ml-auto">{button}</div>
  return (
    <DisabledReasonTooltip reason={blockedReason} className="ml-auto">
      {button}
    </DisabledReasonTooltip>
  )
}
