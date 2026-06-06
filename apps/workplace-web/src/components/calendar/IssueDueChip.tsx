// 이슈 마감일 오버레이 칩 — 읽기전용. 일정(solid bg-primary)과 시각적으로 구분되도록
// 점선 아웃라인 + 깃발 아이콘으로 표시하고, 클릭 시 해당 이슈로 이동한다.
import { Flag } from 'lucide-react'

import type { IssueDueMarker } from '@/types/calendar'

interface IssueDueChipProps {
  marker: IssueDueMarker
  onSelect: (marker: IssueDueMarker) => void
}

export function IssueDueChip({ marker, onSelect }: IssueDueChipProps) {
  return (
    <button
      data-testid={`calendar-issue-due-${marker.issueId}`}
      // 상위 셀/슬롯의 onClick(새 일정 다이얼로그)으로 전파되지 않도록 차단.
      onClick={(ev) => {
        ev.stopPropagation()
        onSelect(marker)
      }}
      title={`${marker.projectKey}-${marker.number} ${marker.title}`}
      className="flex w-full items-center gap-1 truncate rounded border border-dashed border-primary/60 bg-background px-1 py-0.5 text-left text-xs text-foreground"
    >
      <Flag className="size-3 shrink-0 text-primary" aria-hidden="true" />
      <span className="truncate">{marker.title}</span>
    </button>
  )
}
