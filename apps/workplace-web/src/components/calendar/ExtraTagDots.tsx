// 일정 블록 앞 「남은 태그」 색 점(WP-952) — 블록은 첫 태그 색으로 칠하고, 다른 태그가 있으면 그 색을 작은 점으로 알린다.
// 제목 앞에 둔다 — 칩은 한 줄 말줄임이라 제목 뒤에 두면 긴 제목에서 점이 잘려 보이지 않는다.
import { extraTagColors } from '@/lib/calendar'
import { resolvePalette } from '@/lib/calendarPalette'
import type { CalendarEvent } from '@/types/calendar'

export function ExtraTagDots({ event }: { event: Pick<CalendarEvent, 'color' | 'tags' | 'effectiveColor'> }) {
  const colors = extraTagColors(event)
  if (colors.length === 0) return null
  return (
    <span data-testid="calendar-event-extra-tags" className="mr-1 inline-flex shrink-0 items-center gap-0.5 align-middle" aria-hidden="true">
      {colors.map((c) => (
        <span key={c} className={`size-1.5 rounded-full ring-1 ring-background ${resolvePalette(c).dotClass}`} />
      ))}
    </span>
  )
}
