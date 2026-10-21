// RSVP 응답 버튼 — 수락/거절/미정.
// 현재 상태를 강조(variant="default"), 나머지는 outline. 색만으로 상태를 전하지 않도록 aria-pressed 로도 알린다(WP-637).
// 본인이 참석자이고 주최자가 아니며 AGENT 가 아닐 때만 렌더. (이슈 #489)
import { Button } from '@/components/ui/button'
import { useRsvp } from '@/hooks/queries/useCalendarMutations'
import { RSVP_LABEL } from '@/lib/calendarEventView'
import type { RsvpStatus } from '@/types/calendar'

interface RsvpControlsProps {
  eventId: number
  /** 현재 내 RSVP 상태 */
  current: RsvpStatus
}

// 버튼 순서: 수락 → 미정 → 거절 — 문구는 상세 보기 요약과 같은 RSVP_LABEL(WP-708)
const RSVP_OPTIONS = (['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((status) => ({ status, label: RSVP_LABEL[status] }))

/**
 * RSVP 응답 버튼 그룹.
 * 현재 상태가 강조되며, 클릭 시 PATCH /calendar/events/{id}/rsvp 호출.
 */
export function RsvpControls({ eventId, current }: RsvpControlsProps) {
  const rsvp = useRsvp(eventId)

  return (
    // role=group + 이름 — 스크린리더가 세 버튼을 「참석 여부」 묶음으로 읽는다.
    <div role="group" aria-label="참석 여부" className="flex gap-1.5" data-testid="rsvp-controls">
      {RSVP_OPTIONS.map(({ status, label }) => (
        <Button
          key={status}
          type="button"
          size="sm"
          variant={current === status ? 'default' : 'outline'}
          // 토글 버튼 패턴 — 지금 응답이면 「눌림」으로 읽힌다(응답 전 NEEDS_ACTION 이면 셋 다 false).
          aria-pressed={current === status}
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
