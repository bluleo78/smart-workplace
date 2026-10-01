// 시스템 위젯 모바일 요약 한 줄(WP-142) — 각 본문이 이미 쓰는 쿼리 훅을 같은 인자(=같은 쿼리 키)로 다시 불러
// 추가 요청 없이 접힘·타일 한 줄을 만든다. 무엇을 고를지는 summaryLogic(vitest)에 있다.
import { notifLabel } from '@/components/home/notifTarget'
import { useSynthesisCounts } from '@/components/home/synthesis/useSynthesisCounts'
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import { useMessagingSummary } from '@/hooks/queries/useMessagingSummary'
import { flattenNotificationPages, useNotifications } from '@/hooks/queries/useNotifications'
import { usePriorityItems } from '@/hooks/queries/usePriorityItems'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'
import { buildMyTaskRows, dueLabel } from '@/lib/myTasks'

import { mailSender } from '../../dashboard/bodyRules'
import type { MobileSummaryProps } from '../types'
import { Muted } from './Muted'
import { summarize, useNextCalendarEvent } from './summarize'
import {
  eventTimeLabel,
  latestUnreadNotification,
  mailBadgeCount,
  pickLatestMail,
  quadrantLabel,
  topPriorityItem,
} from './summaryLogic'

/** 요약 — `마감 3 · 멘션 2 · 회신 5 · 일정 4 · 확인 1`(숫자만 ai-accent 강조, 시안 ③). */
export function SynthesisSummary({ render }: MobileSummaryProps) {
  const { loading, cells } = useSynthesisCounts()
  // 칸별 실패는 '–' 로 보이므로 요약 전체 오류 상태는 없다(로딩만 본다).
  return summarize(render, [{ isLoading: loading, isError: false }], () => ({
    status: 'ready',
    text: (
      <span className="text-xs text-muted-foreground">
        {cells.map((c, i) => (
          <span key={c.key}>
            {i > 0 ? ' · ' : ''}
            {c.short} <b className="font-semibold text-ai-accent">{c.error ? '–' : c.count}</b>
          </span>
        ))}
      </span>
    ),
  }))
}

/** 내 작업 — 기다리는 건수 배지 + 가장 급한 1건 + (마감 버킷이면) D-n. MyTasksBody 와 같은 쿼리·분류. */
export function MyTasksSummary({ render }: MobileSummaryProps) {
  const assigned = useMyIssues({ assignee: 'me', size: 50 })
  const watched = useWatchedIssues()
  return summarize(render, [assigned, watched], () => {
    const now = new Date()
    const result = buildMyTaskRows(assigned.data?.items ?? [], watched.data?.items ?? [], 1, now)
    const top = result.rows[0]
    if (result.isEmpty || !top) return { status: 'ready', text: <Muted>지금 손댈 일이 없어요</Muted> }
    return {
      status: 'ready',
      count: result.waitingCount,
      text: top.issue.title,
      meta:
        top.bucket === 'due' && top.issue.dueDate ? (
          <span className="text-xs font-semibold text-destructive">{dueLabel(top.issue.dueDate, now)}</span>
        ) : undefined,
    }
  })
}

/** 오늘 일정 — 건수 배지 + `다음 HH:mm 제목`(없으면 "오늘 일정 없음"/"남은 일정 없음"). */
export function CalendarTodaySummary({ render }: MobileSummaryProps) {
  const { query, events, next } = useNextCalendarEvent()
  return summarize(render, [query], () => {
    if (events.length === 0) return { status: 'ready', text: <Muted>오늘 일정 없음</Muted> }
    if (!next) return { status: 'ready', count: events.length, text: <Muted>남은 일정 없음</Muted> }
    return {
      status: 'ready',
      count: events.length,
      prefix: (
        <span className="text-muted-foreground tabular-nums">
          다음 {eventTimeLabel(next)}
        </span>
      ),
      text: next.title,
    }
  })
}

/** 알림 — 안 읽은 건수 배지 + 최신 1건 제목. NotificationsBody 와 같은 첫 페이지 쿼리. */
export function NotificationsSummary({ render }: MobileSummaryProps) {
  const q = useNotifications(true)
  // 배지 건수는 첫 페이지(20건)가 아닌 전체 안 읽음 수 — 앱 셸이 상시 구독하는 캐시를 그대로 쓴다.
  const unread = useUnreadCount()
  // 로딩·오류는 목록 쿼리만 본다 — 배지 건수 쿼리가 늦거나 실패해도 한 줄은 그린다(배지만 생략).
  return summarize(render, [q], () => {
    const latest = latestUnreadNotification(flattenNotificationPages(q.data?.pages))
    if (!latest) return { status: 'ready', text: <Muted>새 알림 없음</Muted> }
    return { status: 'ready', count: unread.data, text: notifLabel(latest) }
  })
}

/** 메일 — 회신 필요(분류 꺼짐이면 안 읽음) 건수 배지 + 최신 발신자·제목. */
export function UnreadMailSummary({ render }: MobileSummaryProps) {
  const q = useMailSummary()
  return summarize(render, [q], () => {
    if (!q.data) return { status: 'error' }
    const latest = pickLatestMail(q.data.recent)
    if (!latest) return { status: 'ready', text: <Muted>안 읽은 메일 없음</Muted> }
    return {
      status: 'ready',
      count: mailBadgeCount(q.data),
      text: (
        <>
          <span className="font-medium">{mailSender(latest)}</span> · {latest.subject ?? '(제목 없음)'}
        </>
      ),
    }
  })
}

/** 대화 — 회신 대기 건수 배지 + 최신 대화명·미리보기. */
export function RecentChatsSummary({ render }: MobileSummaryProps) {
  const q = useMessagingSummary()
  return summarize(render, [q], () => {
    if (!q.data) return { status: 'error' }
    const c = q.data.recent[0]
    if (!c) return { status: 'ready', text: <Muted>최근 대화 없음</Muted> }
    return {
      status: 'ready',
      count: q.data.needsReplyCount,
      text: (
        <>
          <span className="font-medium">{c.label}</span>{' '}
          <span className="text-muted-foreground">{c.lastMessagePreview}</span>
        </>
      ),
    }
  })
}

/** 빠른 액션 — 데이터 없음, 버튼 이름 나열(QuickActions 의 ACTIONS 순서). */
export function QuickActionsSummary({ render }: MobileSummaryProps) {
  return render({ status: 'ready', text: '새 이슈 · 메일 작성 · 새 대화' })
}

/** AI 우선순위(타일) — 건수 + 최상위 1건(사분면 칩). 위젯 deepLink 가 없어 탭하면 그 항목으로 간다. */
export function PriorityQuadrantSummary({ render }: MobileSummaryProps) {
  const q = usePriorityItems()
  return summarize(render, [q], () => {
    const items = q.data?.items ?? []
    const top = topPriorityItem(items)
    if (!top) return { status: 'ready', text: <Muted>정리된 우선순위 없음</Muted> }
    const label = quadrantLabel(top)
    return {
      status: 'ready',
      count: items.length,
      to: top.deepLink,
      prefix: (
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${label === '긴급·중요' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
        >
          {label}
        </span>
      ),
      text: top.title,
    }
  })
}
