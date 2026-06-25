// RSVP 응답 버튼 — 수락/거절/미정.
// 현재 상태를 강조(variant="default"), 나머지는 outline.
// 본인이 참석자이고 주최자가 아니며 AGENT 가 아닐 때만 렌더. (이슈 #489)
import { Button } from '@/components/ui/button'
import { useRsvp } from '@/hooks/queries/useCalendarMutations'
import type { RsvpStatus } from '@/types/calendar'

interface RsvpControlsProps {
  eventId: number
  /** 현재 내 RSVP 상태 */
  current: RsvpStatus
}

// 버튼 순서: 수락 → 미정 → 거절
const RSVP_OPTIONS: { status: RsvpStatus; label: string }[] = [
  { status: 'ACCEPTED', label: '수락' },
  { status: 'TENTATIVE', label: '미정' },
  { status: 'DECLINED', label: '거절' },
]

/**
 * RSVP 응답 버튼 그룹.
 * 현재 상태가 강조되며, 클릭 시 PATCH /calendar/events/{id}/rsvp 호출.
 */
export function RsvpControls({ eventId, current }: RsvpControlsProps) {
  const rsvp = useRsvp(eventId)

  return (
    <div className="flex gap-1.5" data-testid="rsvp-controls">
      {RSVP_OPTIONS.map(({ status, label }) => (
        <Button
          key={status}
          type="button"
          size="sm"
          variant={current === status ? 'default' : 'outline'}
          disabled={rsvp.isPending}
          onClick={() => rsvp.mutate(status)}
          data-testid={`rsvp-btn-${status.toLowerCase()}`}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
