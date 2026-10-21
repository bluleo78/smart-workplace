// 캘린더 태그 칩 — 색 점 + 이름, 둥근 색 테두리(일정 상세 머리 칩 줄·시안 ②-A). (WP-714)
// 캘린더·읽기 전용 사유 칩(모서리 작은 회색 알약)과 달리 완전히 둥글고 색 테두리를 둬 「분류 표시」임이 구분된다.
import { Plus } from 'lucide-react'
import type { ComponentProps } from 'react'

import { resolvePalette } from '@/lib/calendarPalette'
import { cn } from '@/lib/utils'
import type { CalendarTagRef } from '@/types/calendar'

/** 태그 한 개를 칩으로 그린다. 이름이 길면 말줄임(전체 이름은 title). */
export function CalendarTagChip({ tag, className }: { tag: CalendarTagRef; className?: string }) {
  const palette = resolvePalette(tag.color)
  return (
    <span
      data-testid="event-detail-tag"
      title={tag.name}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
        palette.tagChipClass,
        className,
      )}
    >
      <span className={`size-2 shrink-0 rounded-full ${palette.dotClass}`} aria-hidden="true" />
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

/**
 * 「＋ 태그」 칩 — 태그 피커(CalendarTagPicker)를 여는 트리거. 점선 테두리로 「붙이는 자리」임을 보이고, 태그 칩과 같은 둥근 모양이다.
 * 상세 보기 머리 칩 줄과 편집 폼 태그 줄이 같이 쓴다. PopoverTrigger asChild 가 넘기는 ref·이벤트를 그대로 받도록 props 를 펼친다.
 */
export function CalendarTagAddButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      <Plus className="size-3" aria-hidden="true" />
      태그
    </button>
  )
}
