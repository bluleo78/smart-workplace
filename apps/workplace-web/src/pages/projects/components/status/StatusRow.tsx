// 설정 「상태」 섹션의 상태 한 행(WP-809) — ⋮⋮ 손잡이 · 상태 아이콘(모양=범주, 색=상태 색) · 이름 · 「기본」 · 이슈 수 · ⋯.
// 손잡이는 데스크톱 OWNER 에게만(모바일은 터치 끌기가 스크롤과 충돌해 ⋯ 시트의 위로/아래로가 대신한다).
// 멤버(편집 권한 없음)는 손잡이·⋯ 없이 읽기 전용으로 본다.
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useId } from 'react'

import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { ProjectStatus } from '@/types/projectStatus'

/** 「기본」 배지 툴팁 — 범주로만 상태를 바꿀 때 어느 상태로 들어가는지 알린다. */
export const DEFAULT_BADGE_TOOLTIP = '범주로만 상태를 바꿀 때 들어가는 상태예요'

/** 범주의 마지막 상태 삭제 비활성 이유(서버 409 와 같은 문구). */
export const LAST_IN_CATEGORY_REASON = '범주의 마지막 상태는 지울 수 없어요'

/** 행에서 할 수 있는 일 — 위/아래 이동은 범주 경계면 null(비활성). */
export interface StatusRowActions {
  onEdit: () => void
  onMoveUp: (() => void) | null
  onMoveDown: (() => void) | null
  /** 범주의 마지막 상태면 null(비활성 + 이유 표시). */
  onDelete: (() => void) | null
}

export function StatusRow({
  status,
  isDefault,
  count,
  canEdit,
  isMobile,
  actions,
  onOpenSheet,
}: {
  status: ProjectStatus
  isDefault: boolean
  /** 이 상태의 활성 이슈 수 — 아직 모르면 undefined(칸을 비운다). */
  count: number | undefined
  canEdit: boolean
  isMobile: boolean
  actions: StatusRowActions
  /** 모바일 ⋯ — 행 액션 시트를 연다. */
  onOpenSheet: () => void
}) {
  const draggable = canEdit && !isMobile
  // 손잡이에서만 끌기가 시작된다(행 안 ⋯ 버튼과 제스처 분리). 끌 수 없으면 sortable 을 꺼 둔다.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
    disabled: !draggable,
  })
  const style = { transform: CSS.Translate.toString(transform), transition }

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`status-row-${status.id}`}
      className={cn(
        'flex min-h-10 items-center gap-2 rounded-md border bg-card px-2 py-1.5',
        isDragging && 'relative z-10 shadow-md',
      )}
    >
      {draggable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          data-testid={`status-drag-${status.id}`}
          aria-label={`순서 바꾸기: ${status.name}`}
          className="-ml-1 flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <IssueStatusIcon status={status.category} color={status.color} name={status.name} decorative />
      {/* 30자 이름도 한 줄로 자르고 전체 이름은 title 로 — 행 오른쪽 이슈 수·⋯ 가 밀려나지 않게. */}
      <span className="min-w-0 truncate text-sm font-medium" title={status.name}>
        {status.name}
      </span>
      {isDefault && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              data-testid={`status-default-badge-${status.id}`}
              className="shrink-0 rounded border border-primary/40 px-1 text-xs leading-4 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              기본
            </span>
          </TooltipTrigger>
          <TooltipContent>{DEFAULT_BADGE_TOOLTIP}</TooltipContent>
        </Tooltip>
      )}
      <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums">
        {count != null && `${formatNumber(count)}개`}
      </span>
      {canEdit &&
        (isMobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-my-1 -mr-1 size-10 shrink-0"
            data-testid={`status-menu-${status.id}`}
            aria-label={`${status.name} 메뉴`}
            onClick={onOpenSheet}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        ) : (
          <StatusRowMenu status={status} actions={actions} />
        ))}
    </li>
  )
}

/** 데스크톱 ⋯ 메뉴 — 편집 · 위로/아래로 이동(끌기의 키보드 대체) · 삭제. */
function StatusRowMenu({ status, actions }: { status: ProjectStatus; actions: StatusRowActions }) {
  const reasonId = useId()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 h-7 w-7 shrink-0"
          data-testid={`status-menu-${status.id}`}
          aria-label={`${status.name} 메뉴`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={actions.onEdit}>
          <Pencil />
          편집
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!actions.onMoveUp} onSelect={() => actions.onMoveUp?.()}>
          <ArrowUp />
          위로 이동
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!actions.onMoveDown} onSelect={() => actions.onMoveDown?.()}>
          <ArrowDown />
          아래로 이동
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={!actions.onDelete}
          aria-describedby={actions.onDelete ? undefined : reasonId}
          onSelect={() => actions.onDelete?.()}
        >
          <Trash2 />
          삭제
        </DropdownMenuItem>
        {/* 막힌 항목은 흐리게(opacity) 그려지므로 이유는 항목 밖에 또렷한 글자로 둔다 — 키보드는 aria-describedby 로 듣는다. */}
        {!actions.onDelete && (
          <p id={reasonId} className="px-2 pb-1.5 text-xs text-muted-foreground">
            {LAST_IN_CATEGORY_REASON}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
