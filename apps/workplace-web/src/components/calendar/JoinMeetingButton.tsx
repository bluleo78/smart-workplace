// 온라인 회의 「참가」 버튼 (WP-710) — 일정을 여는 이유가 대개 「들어가기」라 상세 보기·편집 폼 양쪽 머리에 같은 모양으로 둔다.
// 주소는 서버가 http(s) 만 판정해 내려 주므로 그대로 링크로 쓰고, 새 탭에서 연다(noopener 로 opener 차단).
import { Video } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { joinButtonLabel } from '@/lib/calendarEventView'
import type { CalendarEvent } from '@/types/calendar'

interface JoinMeetingButtonProps {
  onlineMeeting: NonNullable<CalendarEvent['onlineMeeting']>
  /** 화면별 E2E 식별자 — 상세 보기와 편집 폼이 한 화면에 같이 뜨지 않지만 위치를 구분한다. */
  testId: string
}

export function JoinMeetingButton({ onlineMeeting, testId }: JoinMeetingButtonProps) {
  return (
    <Button asChild className="mt-1 w-full" data-testid={testId}>
      <a href={onlineMeeting.joinUrl} target="_blank" rel="noopener noreferrer">
        <Video aria-hidden="true" />
        {joinButtonLabel(onlineMeeting.provider)}
      </a>
    </Button>
  )
}
