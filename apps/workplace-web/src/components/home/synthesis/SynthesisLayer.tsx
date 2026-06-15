// ① 합성 레이어 — 게이트 §1.1. 클라이언트 단순·설명가능 규칙으로
// 이미 받아온 위젯 데이터를 재가공한다(새 백엔드·AI 없음).
//   - 상태 카운트 스트립: 오늘 마감 · @멘션 · 안 읽음 · 오늘 일정 (각 셀 = 모듈 딥링크)
//   - 주의 필요: 크로스앱 급한 것만(마감 지난/오늘 + 멘션 + 중요 메일), 행 딥링크
// 페치 정책: notifications·mail·calendar 훅은 ③ 위젯 바디와 동일 키 → TanStack Query 가 dedupe(이중 페치 없음).
//   단 useMyIssueDues 는 어느 ③ 바디도 쓰지 않는 합성 전용 추가 쿼리다(마감 마커 — 스펙 허용).
import { AlertTriangle, CalendarClock, CheckCircle2, Mail, MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { useNotifications } from '@/hooks/queries/useNotifications'
import { parseUtcDate } from '@/lib/formatters'
import type { IssueDueMarker } from '@/types/calendar'
import type { MailSummaryItem } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { isMentionLike, notifLabel, notifTarget } from '../notifTarget'

// 오늘 00:00~24:00(로컬) ISO 범위 — CalendarTodayBody 와 동일 규칙으로 캘린더 쿼리 dedupe.
function todayRange(): { from: string; to: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

// yyyy-MM-dd(로컬) — 마감일(LocalDate) 비교용.
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 주의 필요 한 행의 표준 모델.
interface AttentionRow {
  key: string
  source: '이슈' | '멘션' | '메일'
  title: string
  meta: string // 우측 정렬 메타(마감/시각/중요)
  to: string
  ariaLabel: string
  urgency: number // 작을수록 위(0=마감지남/오늘, 1=멘션, 2=중요메일)
  recency: number // 동일 urgency 내 최신순(epoch ms, 클수록 위)
}

// 카운트 셀 — 로딩 시 셀만 스켈레톤(격리), 에러 시 '–'.
function CountCell({
  label,
  count,
  to,
  loading,
  error,
}: {
  label: string
  count: number
  to: string
  loading: boolean
  error: boolean
}) {
  return (
    <Link
      to={to}
      aria-label={error ? `${label} 불러오기 실패` : `${label} ${count}건`}
      className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-card px-2 py-2 text-center hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {loading ? (
        <Skeleton className="h-6 w-8" />
      ) : (
        <span className="text-xl font-semibold text-ai-accent">{error ? '–' : count}</span>
      )}
      <span className="text-xs text-muted-foreground">{label}</span>
    </Link>
  )
}

const SOURCE_ICON = {
  이슈: CalendarClock,
  멘션: MessageSquare,
  메일: Mail,
} as const

/** ① 합성 레이어 — 카운트 스트립 + 주의 필요 리스트. 소스별 에러/로딩 격리. */
export function SynthesisLayer() {
  const today = new Date()
  const todayKey = localDateKey(today)
  const { from, to } = todayRange()

  // 마감 이슈 — 1년 전~오늘로 한 번에 조회해 '오늘 마감' 카운트와 '지남+오늘' 주의 행을 분리 산출.
  const dueFrom = new Date(today)
  dueFrom.setFullYear(dueFrom.getFullYear() - 1)
  const dues = useMyIssueDues(dueFrom.toISOString(), to)

  // 멘션(코멘트 프록시) — 알림 목록 재사용(위젯과 동일 키 → dedupe).
  const notifs = useNotifications(true)
  // 안 읽은 메일 — 카운트 + 최근(중요 메일 추출).
  const mail = useMailSummary()
  // 오늘 일정.
  const events = useCalendarEvents(from, to)

  // ── 카운트 산출(소스별 에러/로딩 격리) ──────────────────────────────────
  const dueItems: IssueDueMarker[] = dues.data ?? []
  const dueTodayCount = dueItems.filter((d) => d.dueDate === todayKey).length

  const notifItems: NotificationResponse[] = notifs.data ?? []
  const mentionCount = notifItems.filter((n) => isMentionLike(n) && !n.read).length

  const unreadMail = mail.data?.unreadCount ?? 0

  const todayEventCount = (events.data ?? []).length

  // ── 주의 필요 병합(클라이언트 규칙) ────────────────────────────────────
  const rows: AttentionRow[] = []

  // 1) 마감 지남/오늘 이슈 — urgency 0.
  if (!dues.isError) {
    for (const d of dueItems) {
      if (d.dueDate <= todayKey) {
        const overdue = d.dueDate < todayKey
        rows.push({
          key: `due-${d.issueId}`,
          source: '이슈',
          title: d.title,
          meta: overdue ? '마감 지남' : '오늘 마감',
          to: `/projects/${d.projectKey}/issues/${d.number}`,
          ariaLabel: `이슈 열기: ${d.title}`,
          urgency: 0,
          // 마감일만 있어 recency 는 마감일 epoch(지난 게 더 위로 오게 음수 정렬은 urgency 가 처리).
          recency: parseUtcDate(`${d.dueDate}T00:00:00Z`).getTime(),
        })
      }
    }
  }

  // 2) @멘션(안 읽은 COMMENTED) — urgency 1.
  if (!notifs.isError) {
    for (const n of notifItems) {
      if (isMentionLike(n) && !n.read) {
        rows.push({
          key: `notif-${n.id}`,
          source: '멘션',
          title: notifLabel(n),
          meta: '멘션',
          to: notifTarget(n),
          ariaLabel: `알림 열기: ${notifLabel(n)}`,
          urgency: 1,
          recency: parseUtcDate(n.createdAt).getTime(),
        })
      }
    }
  }

  // 3) 중요/안 읽은 메일 — recent 상위(안 읽은 것) urgency 2.
  if (!mail.isError) {
    const recent: MailSummaryItem[] = mail.data?.recent ?? []
    for (const m of recent.filter((x) => !x.seen).slice(0, 3)) {
      rows.push({
        key: `mail-${m.id}`,
        source: '메일',
        title: m.subject?.trim() || '(제목 없음)',
        meta: '중요',
        to: '/mail',
        ariaLabel: `메일 열기: ${m.subject?.trim() || '(제목 없음)'}`,
        urgency: 2,
        recency: m.receivedAt ? parseUtcDate(m.receivedAt).getTime() : 0,
      })
    }
  }

  // 긴급도 우선, 동일 긴급도 내 최신순. 상위 5건.
  rows.sort((a, b) => a.urgency - b.urgency || b.recency - a.recency)
  const top = rows.slice(0, 5)

  // 카운트 셀 로딩/에러 플래그(셀 단위 격리).
  const cells = [
    { label: '오늘 마감', count: dueTodayCount, to: '/me/tasks/assigned', q: dues },
    { label: '멘션', count: mentionCount, to: '/me/tasks/assigned', q: notifs },
    { label: '안 읽음', count: unreadMail, to: '/mail', q: mail },
    { label: '오늘 일정', count: todayEventCount, to: '/calendar', q: events },
  ]

  return (
    <Card className="border-l-2 border-l-ai-accent" data-testid="dashboard-synthesis">
      <CardContent className="space-y-4 pt-4">
        {/* 상태 카운트 스트립 — 4셀, 각 셀 모듈 딥링크. */}
        <div className="grid grid-cols-4 gap-4" data-testid="dashboard-counts">
          {cells.map((c) => (
            <CountCell
              key={c.label}
              label={c.label}
              count={c.count}
              to={c.to}
              loading={c.q.isLoading}
              error={c.q.isError}
            />
          ))}
        </div>

        {/* 주의 필요 — 크로스앱 급한 것만. 비면 차분한 빈 상태. */}
        <div data-testid="dashboard-attention">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            주의 필요{top.length > 0 ? ` (${top.length})` : ''}
          </div>
          {top.length === 0 ? (
            <div
              className="flex items-center gap-2 rounded-md border border-border px-3 py-3 text-sm text-muted-foreground"
              data-testid="dashboard-attention-empty"
            >
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              다 확인했어요 ✅
            </div>
          ) : (
            <ul className="space-y-0.5 border-l-2 border-l-destructive pl-2">
              {top.map((r) => {
                const Icon = SOURCE_ICON[r.source]
                return (
                  <li key={r.key}>
                    <Link
                      to={r.to}
                      aria-label={r.ariaLabel}
                      className="flex min-h-6 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {/* 소스 라벨 칩 */}
                      <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        <Icon className="h-3 w-3" />
                        {r.source}
                      </span>
                      <span className="truncate">{r.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {r.meta}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
