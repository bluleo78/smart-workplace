// 일정 편집 폼의 「태그」 줄 (WP-714, 설계 노트 「편집 폼(주최자)에도 같은 태그 줄」).
// 상세 보기 머리의 칩 줄과 같은 칩·같은 「＋ 태그」 피커를 쓰고, 폼의 저장 버튼과 상관없이 체크하면 바로 저장된다.
// 이미 있는 일정에서만 보인다 — 새 일정은 아직 id 가 없어 붙일 곳이 없다(만든 뒤 상세·편집에서 붙인다).
import { CalendarTagAddButton, CalendarTagChip } from '@/components/calendar/CalendarTagChip'
import { CalendarTagPicker } from '@/components/calendar/CalendarTagPicker'
import type { CalendarEvent } from '@/types/calendar'

/**
 * 편집 폼 태그 줄 — 태그 칩 + (붙일 수 있으면) 「＋ 태그」. 붙일 수 없는 외부(M365) 일정은 칩과 Outlook 범주 안내만 보이고,
 * 그런 일정에 태그도 없으면 줄째 숨긴다. event 는 상세 응답(태그 포함)이어야 한다.
 */
export function EventTagsField({ event }: { event: CalendarEvent }) {
  const tags = event.tags ?? []
  const editable = event.tagsEditable ?? false
  if (!editable && tags.length === 0) return null

  return (
    <div className="space-y-1.5" data-testid="calendar-form-tags">
      <div className="text-sm font-medium">태그</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <CalendarTagChip key={t.id} tag={t} />
        ))}
        {editable && (
          <CalendarTagPicker eventId={event.id} current={tags}>
            <CalendarTagAddButton data-testid="calendar-form-tag-add" />
          </CalendarTagPicker>
        )}
      </div>
      {!editable && (
        <p className="text-xs text-muted-foreground">Outlook 범주에서 가져온 태그예요 · Outlook에서 바꿀 수 있어요</p>
      )}
    </div>
  )
}
