// RSVP 응답 버튼 — 수락/거절/미정.
// 현재 상태를 강조(variant="default"), 나머지는 outline. 색만으로 상태를 전하지 않도록 aria-pressed 로도 알린다(WP-637).
// 일정 상세에서는 본인이 참석자이고 주최자가 아니며 AGENT 가 아닐 때만 렌더. (이슈 #489)
// 버튼 묶음(RsvpButtons)은 응답 방법과 떨어져 있어, 메일의 일정 초대 카드(WP-986)도 같은 버튼을 다른 API 로 쓴다.
import { Button } from '@/components/ui/button'
import { useRsvp } from '@/hooks/queries/useCalendarMutations'
import { RSVP_LABEL } from '@/lib/calendarEventView'
import type { RsvpStatus } from '@/types/calendar'

/** 고를 수 있는 응답(응답 전 NEEDS_ACTION 은 버튼이 아니다). */
export type RsvpChoice = Exclude<RsvpStatus, 'NEEDS_ACTION'>

// 버튼 순서: 수락 → 미정 → 거절 — 문구는 상세 보기 요약과 같은 RSVP_LABEL(WP-708)
const RSVP_OPTIONS = (['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((status) => ({ status, label: RSVP_LABEL[status] }))

interface RsvpButtonsProps {
  /** 현재 내 RSVP 상태 — 이 버튼이 강조·눌림으로 보인다. */
  current: RsvpStatus
  /** 응답을 보내는 중 — 세 버튼을 모두 막아 겹쳐 보내지 않게 한다. */
  pending: boolean
  /** 버튼을 눌렀을 때 — 무엇으로 보낼지는 호출 측이 정한다. */
  onRespond: (status: RsvpChoice) => void
}

/**
 * RSVP 응답 버튼 묶음(표시 전용) — 지금 응답을 강조하고, 누르면 onRespond 를 부른다.
 * 일정 상세(RsvpControls)와 메일 초대 카드가 같은 모양·문구·접근성을 쓰도록 한 곳에 둔다.
 */
export function RsvpButtons({ current, pending, onRespond }: RsvpButtonsProps) {
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
          disabled={pending}
          onClick={() => onRespond(status)}
          data-testid={`rsvp-btn-${status.toLowerCase()}`}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

interface RsvpControlsProps {
  eventId: number
  /** 현재 내 RSVP 상태 */
  current: RsvpStatus
}

/**
 * 일정 상세의 RSVP 응답 버튼 그룹.
 * 현재 상태가 강조되며, 클릭 시 PATCH /calendar/events/{id}/rsvp 호출.
 */
export function RsvpControls({ eventId, current }: RsvpControlsProps) {
  const rsvp = useRsvp(eventId)
  return <RsvpButtons current={current} pending={rsvp.isPending} onRespond={(status) => rsvp.mutate(status)} />
}
