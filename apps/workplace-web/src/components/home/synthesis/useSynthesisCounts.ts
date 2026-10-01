// 요약 위젯 KPI 5종 건수(WP-142) — 모바일 접힘 한 줄용. SynthesisLayer 와 같은 훅·같은 인자(=같은 쿼리 키)를 써서
// TanStack Query 가 요청을 합친다(이중 페치 없음). 집계 규칙(오늘 마감·안 읽은 멘션·메일 스왑·오늘 일정·확인 필요)도 같다.
// SynthesisLayer 자체는 행(지금 신경 쓸 일) 계산까지 함께 하므로 이번 범위에서 이 훅으로 바꾸지 않는다(데스크톱 불변).
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import { useMessagingSummary } from '@/hooks/queries/useMessagingSummary'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { flattenNotificationPages, useNotifications } from '@/hooks/queries/useNotifications'
import { todayRange } from '@/lib/calendarRange'

import { isMentionLike } from '../notifTarget'
import { mailBadgeCount } from '../widgets/mobile/summaries/summaryLogic'
import { dueQueryFrom, localDateKey } from './synthesisDates'

/** KPI 한 칸 — short 는 접힘 한 줄용 짧은 라벨, error 면 숫자 대신 '–'. */
export interface SynthesisCountCell {
  key: 'due' | 'mention' | 'mail' | 'event' | 'chat'
  short: string
  count: number
  error: boolean
}

/** KPI 5종 건수. 하나라도 로딩 중이면 loading(한 줄 스켈레톤), 실패한 칸만 error. */
export function useSynthesisCounts(): { loading: boolean; cells: SynthesisCountCell[] } {
  const today = new Date()
  const todayKey = localDateKey(today)
  const { from, to } = todayRange()
  // SynthesisLayer 와 같은 날짜 헬퍼(synthesisDates)로 1년 전~오늘 범위를 만들어 같은 쿼리 키로 합쳐진다.
  const dues = useMyIssueDues(dueQueryFrom(today), to)
  const notifs = useNotifications(true)
  const mail = useMailSummary()
  const events = useCalendarEvents(from, to)
  const messaging = useMessagingSummary()

  const loading = [dues, notifs, mail, events, messaging].some((q) => q.isLoading)
  const classifyOn = mail.data?.classificationActive ?? false
  const cells: SynthesisCountCell[] = [
    {
      key: 'due',
      short: '마감',
      count: (dues.data ?? []).filter((d) => d.dueDate === todayKey).length,
      error: dues.isError,
    },
    {
      key: 'mention',
      short: '멘션',
      count: flattenNotificationPages(notifs.data?.pages).filter((n) => isMentionLike(n) && !n.read).length,
      error: notifs.isError,
    },
    {
      key: 'mail',
      short: classifyOn ? '회신' : '안 읽음',
      count: mailBadgeCount(mail.data),
      error: mail.isError,
    },
    { key: 'event', short: '일정', count: (events.data ?? []).length, error: events.isError },
    { key: 'chat', short: '확인', count: messaging.data?.attentionCount ?? 0, error: messaging.isError },
  ]
  return { loading, cells }
}
