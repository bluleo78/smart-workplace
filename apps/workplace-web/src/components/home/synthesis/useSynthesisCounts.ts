// 요약 위젯 KPI 5종 건수(WP-142) — 모바일 접힘 한 줄용. SynthesisLayer 와 같은 훅·같은 인자(=같은 쿼리 키)를 써서
// TanStack Query 가 요청을 합친다(이중 페치 없음). 집계 규칙은 SynthesisLayer 와 같은 computeSynthesisCounts 하나를 쓴다(WP-161).
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import { useMessagingSummary } from '@/hooks/queries/useMessagingSummary'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { flattenNotificationPages, useNotifications } from '@/hooks/queries/useNotifications'
import { todayRange } from '@/lib/calendarRange'

import { computeSynthesisCounts } from './computeSynthesisCounts'
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
  const counts = computeSynthesisCounts({
    dues: dues.data ?? [],
    notifications: flattenNotificationPages(notifs.data?.pages),
    mail: mail.data,
    events: events.data ?? [],
    messaging: messaging.data,
    todayKey,
  })
  const cells: SynthesisCountCell[] = [
    { key: 'due', short: '마감', count: counts.dueToday, error: dues.isError },
    { key: 'mention', short: '멘션', count: counts.mention, error: notifs.isError },
    { key: 'mail', short: counts.classifyOn ? '회신' : '안 읽음', count: counts.mail, error: mail.isError },
    { key: 'event', short: '일정', count: counts.event, error: events.isError },
    { key: 'chat', short: '확인', count: counts.chat, error: messaging.isError },
  ]
  return { loading, cells }
}
