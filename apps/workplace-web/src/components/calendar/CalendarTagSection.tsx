// 캘린더 사이드바 「태그」 묶음 (WP-714, 시안 ③).
// 행: 색 점 · 이름 · 붙은 일정 수(흐리게) · ⋮ 메뉴(이름·색 바꾸기 / 구독 주소… / 태그 지우기). 헤더 「＋」는 새 태그.
// 태그로 걸러 보기는 이번 범위 밖이라 체크박스는 없다 — 보고 관리하는 용도.
// 다이얼로그(만들기/수정/지우기/구독 주소)는 여기서 열지 않고 콜백으로 CalendarPage 에 맡긴다:
// 모바일 ☰ 시트 안에서 열면 시트가 닫히며 다이얼로그도 함께 사라지기 때문이다(WP-578).
import { LinkIcon, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'

import { useCloseSheetAfterMenu } from '@/components/mobile/MobileSidebarSheetContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCalendarTags } from '@/hooks/queries/useCalendarTags'
import { resolvePalette } from '@/lib/calendarPalette'
import type { CalendarTag } from '@/types/calendar'

interface CalendarTagSectionProps {
  onAddTag: () => void
  onEditTag: (tag: CalendarTag) => void
  onDeleteTag: (tag: CalendarTag) => void
  onOpenTagFeed: (tag: CalendarTag) => void
  /** Outlook 등 연동 계정이 있는지 — 있을 때만 「Outlook 범주도 여기 함께 보여요」 안내를 단다 */
  hasLinkedAccount: boolean
}

/** 사이드바 「태그」 묶음 — 내 태그 목록과 관리 메뉴. */
export function CalendarTagSection({ onAddTag, onEditTag, onDeleteTag, onOpenTagFeed, hasLinkedAccount }: CalendarTagSectionProps) {
  const tags = useCalendarTags()
  // 시트 안 ⋮ 메뉴 항목이 시트 밖 다이얼로그를 열 때 시트를 닫는다(캘린더 행 메뉴와 같은 규칙, WP-578)
  const rowMenu = useCloseSheetAfterMenu()
  const list = tags.data ?? []

  return (
    <div className="border-t px-3 pb-3 pt-2" data-testid="calendar-tag-section">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">태그</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          data-testid="calendar-tag-add"
          aria-label="태그 추가"
          data-sheet-dismiss
          onClick={onAddTag}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {tags.isSuccess && list.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="calendar-tag-empty">
          일정 상세에서 태그를 붙이면 여기에 모여요
        </p>
      )}

      {list.map((tag) => (
        <div key={tag.id} data-testid={`calendar-tag-item-${tag.id}`} className="group mb-1 flex items-center gap-2 text-sm">
          {/* 점은 위 캘린더 행의 체크박스 칸(16px)에 맞춰 세로줄을 정렬한다 */}
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            <span className={`size-2.5 rounded-full ${resolvePalette(tag.color).dotClass}`} />
          </span>
          <span className="min-w-0 flex-1 truncate" title={tag.name}>
            {tag.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label={`일정 ${tag.eventCount}개`}>
            {tag.eventCount}
          </span>
          {/* ⋮ 메뉴 — hover 시만 노출(터치 기기는 상시·44px, 캘린더 행과 같은 규칙 WP-237) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
                data-testid={`calendar-tag-menu-${tag.id}`}
                aria-label={`${tag.name} 태그 메뉴`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={rowMenu.onCloseAutoFocus}>
              <DropdownMenuItem
                data-testid={`calendar-tag-edit-${tag.id}`}
                onClick={() => {
                  rowMenu.closeAfterMenu()
                  onEditTag(tag)
                }}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" /> 이름·색 바꾸기
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid={`calendar-tag-feed-${tag.id}`}
                onClick={() => {
                  rowMenu.closeAfterMenu()
                  onOpenTagFeed(tag)
                }}
              >
                <LinkIcon className="mr-2 h-3.5 w-3.5" /> 구독 주소…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid={`calendar-tag-delete-${tag.id}`}
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  rowMenu.closeAfterMenu()
                  onDeleteTag(tag)
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" /> 태그 지우기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}

      {hasLinkedAccount && list.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">Outlook 범주도 여기 함께 보여요</p>
      )}
    </div>
  )
}
