// 일정 끌어 옮기기(WP-1328) 미리보기 칩 — 월 보기와 주·일 보기 종일 줄이 함께 쓴다.
import type { MovePreview } from './useEventMoveDrag'

/** 끌어 옮기는 일정이 놓일 날짜 칸의 반투명 사본(월 보기 칸·종일 줄, WP-1328). 포인터 이벤트를 막지 않아 놓을 칸을 가리지 않는다. */
export function MovePreviewChip({ preview }: { preview: MovePreview | null }) {
  if (!preview) return null
  return (
    <div
      data-testid="calendar-move-preview"
      className="pointer-events-none mb-0.5 w-full truncate rounded border border-primary bg-background px-1 py-0.5 text-xs font-medium text-primary"
    >
      {preview.event.title}
    </div>
  )
}
