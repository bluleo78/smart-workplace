// 일정 편집·새 일정 폼의 「태그」 줄 (WP-714, 일정 편집 폼 배치 B).
// 상세 보기 머리의 칩 줄과 같은 칩·같은 「＋ 태그」 피커를 쓰지만, 여기서는 폼 상태다 — 체크해도 바로 저장하지 않고
// 폼의 「수정」·「저장」을 눌러야 일정 저장 요청에 함께 실려 저장된다(「취소」면 버린다, WP-801). 그래서 아직 id 가 없는 새 일정에도 보인다.
import { Tag } from 'lucide-react'

import { CalendarTagAddButton, CalendarTagChip } from '@/components/calendar/CalendarTagChip'
import { CalendarTagFormPicker } from '@/components/calendar/CalendarTagPicker'
import { EventFormRow, FORM_CHIP_LINE_CLASS } from '@/components/calendar/EventFormRow'
import type { CalendarTagRef } from '@/types/calendar'

interface EventTagsFieldProps {
  /** 폼이 들고 있는 지금 선택 */
  value: CalendarTagRef[]
  onChange: (next: CalendarTagRef[]) => void
  /** 붙이고 뗄 수 있는지 — 새 일정은 늘 true, 기존 일정은 상세 응답의 tagsEditable */
  editable: boolean
  /** 칩 줄 아래 안내(Outlook 범주 반영·Outlook 에서 바꾸기) — eventTagHint 결과 */
  hint: string | null
}

/**
 * 폼 태그 줄 — 태그 칩 + (붙일 수 있으면) 「＋ 태그」. 붙일 수 있는 M365 일정은 Outlook 범주에도 반영된다는 안내를 달고(WP-716),
 * 붙일 수 없는 M365 일정(공유받은 읽기 전용 달력 등)은 칩과 「Outlook에서 바꾸기」 안내만 보이며, 태그도 없으면 줄째 숨긴다.
 */
export function EventTagsField({ value, onChange, editable, hint }: EventTagsFieldProps) {
  if (!editable && value.length === 0) return null

  return (
    <EventFormRow icon={Tag} testId="calendar-form-tags">
      <div className={FORM_CHIP_LINE_CLASS} role="group" aria-label="태그">
        {value.map((t) => (
          <CalendarTagChip key={t.id} tag={t} />
        ))}
        {editable && (
          <CalendarTagFormPicker value={value} onChange={onChange}>
            <CalendarTagAddButton data-testid="calendar-form-tag-add" />
          </CalendarTagFormPicker>
        )}
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground" data-testid="calendar-form-tags-hint">
          {hint}
        </p>
      )}
    </EventFormRow>
  )
}
