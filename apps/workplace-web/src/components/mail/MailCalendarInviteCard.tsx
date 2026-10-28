// 메일 상세의 일정 초대 카드(WP-986) — 초대(.ics) 메일을 열면 헤더와 본문 사이에 보인다.
// 초대(REQUEST)는 제목·일시·장소·주최자·참석자 수와 수락/미정/거절 버튼(일정 상세와 같은 RsvpButtons)을,
// 취소(CANCEL)는 줄 그은 일시와 취소 안내만 보인다. 이후 변경된 옛 초대 메일이면 버튼 대신 「최신 메일에서 응답」 안내.
// 응답하면 서버가 주최자에게 응답을 보내고 내 캘린더를 맞추며, 카드는 돌려받은 초대 정보로 바로 바뀐다.
import { CalendarDays, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { RsvpButtons } from '@/components/calendar/RsvpControls'
import { useRespondToInvite } from '@/hooks/queries/useMailMessages'
import { inviteActionMode, inviteOrganizerText, inviteResultText, inviteTimeText } from '@/lib/calendarInvite'
import { formatNumber } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { CalendarInvite } from '@/types/mailMessage'

interface MailCalendarInviteCardProps {
  /** 초대가 담긴 메일 id — 응답 API 경로와 상세 캐시 갱신에 쓴다. */
  messageId: number
  invite: CalendarInvite
  className?: string
}

/** 일정 초대 카드 — 메일 상세(데스크톱 본문 위·모바일 본문 슬롯 위)가 같은 카드를 쓴다. */
export function MailCalendarInviteCard({ messageId, invite, className }: MailCalendarInviteCardProps) {
  const respond = useRespondToInvite(messageId)
  const cancelled = invite.method === 'CANCEL'
  const mode = inviteActionMode(invite)
  const organizer = inviteOrganizerText(invite.organizer)
  // 결과 문구는 응답할 수 있는 카드에서만 — 취소·옛 초대에는 지난 응답을 다시 알리지 않는다.
  const result = mode === 'respond' ? inviteResultText(invite.myResponse) : null

  return (
    <section
      data-testid="mail-invite-card"
      data-method={invite.method}
      aria-label={cancelled ? '취소된 일정' : '일정 초대'}
      className={cn(
        'rounded-lg border px-3.5 py-3',
        // 초대는 브랜드 색 옅은 바탕, 취소는 빨강 계열 옅은 바탕(시맨틱 토큰만).
        cancelled ? 'border-destructive/30 bg-destructive-subtle' : 'border-primary/30 bg-primary/5',
        className,
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words" data-testid="mail-invite-title">
            {invite.summary || '(제목 없음)'}
          </span>
        </h3>
        <span
          data-testid="mail-invite-tag"
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
            cancelled ? 'bg-destructive/10 text-destructive-text' : 'bg-primary/10 text-primary',
          )}
        >
          {cancelled ? '취소된 일정' : '일정 초대'}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 text-sm">
        <div data-testid="mail-invite-time" className={cn(cancelled && 'text-muted-foreground line-through')}>
          {inviteTimeText(invite)}
        </div>
        {invite.location && (
          <div data-testid="mail-invite-location">
            <span className="text-muted-foreground">장소</span> {invite.location}
          </div>
        )}
        {(organizer || invite.attendeeCount > 0) && (
          <div data-testid="mail-invite-people" className="break-words">
            {organizer && (
              <>
                <span className="text-muted-foreground">주최자</span> {organizer}
              </>
            )}
            {organizer && invite.attendeeCount > 0 && ' · '}
            {invite.attendeeCount > 0 && `참석자 ${formatNumber(invite.attendeeCount)}명`}
          </div>
        )}
      </div>

      {cancelled && (
        <p data-testid="mail-invite-cancelled" className="mt-2 text-xs text-muted-foreground">
          주최자가 일정을 취소했습니다.
        </p>
      )}
      {mode === 'outdated' && (
        <p data-testid="mail-invite-outdated" className="mt-2 text-xs text-muted-foreground">
          이 초대는 이후 변경되었습니다 — 최신 메일에서 응답하세요
        </p>
      )}

      {(mode === 'respond' || invite.eventId != null) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {mode === 'respond' && (
            <RsvpButtons
              current={invite.myResponse}
              pending={respond.isPending}
              onRespond={(status) => respond.mutate(status)}
            />
          )}
          {invite.eventId != null && (
            <Link
              to={`/calendar?eventId=${invite.eventId}`}
              data-testid="mail-invite-open-calendar"
              className="ml-auto inline-flex items-center text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              캘린더에서 보기
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
      {result && (
        // 응답 직후 스크린리더에도 결과를 알린다(polite).
        <p data-testid="mail-invite-result" role="status" className="mt-1.5 text-xs text-muted-foreground">
          {result}
        </p>
      )}
    </section>
  )
}
