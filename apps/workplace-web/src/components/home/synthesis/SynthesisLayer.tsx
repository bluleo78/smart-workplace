// ① 합성 레이어 — 게이트 §1.1. 클라이언트 단순·설명가능 규칙으로
// 이미 받아온 위젯 데이터를 재가공한다(새 백엔드·AI 없음).
//   - 상태 카운트 스트립: 오늘 마감 · @멘션 · 안 읽음(또는 회신 필요) · 오늘 일정 (각 셀 = 모듈 딥링크)
//   - 지금 신경 쓸 일: 크로스앱 급한 것만(마감 지난/오늘 + 멘션 + 회신 필요 메일), 최상위 포커스 카드 + 행 딥링크
// 페치 정책: notifications·mail·calendar 훅은 ③ 위젯 바디와 동일 키 → TanStack Query 가 dedupe(이중 페치 없음).
//   단 useMyIssueDues 는 어느 ③ 바디도 쓰지 않는 합성 전용 추가 쿼리다(마감 마커 — 스펙 허용).
import { AlertTriangle, CalendarClock, CheckCircle2, Mail, MessageSquare, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { useNotifications } from '@/hooks/queries/useNotifications'
import { parseUtcDate } from '@/lib/formatters'
import type { IssueDueMarker } from '@/types/calendar'
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

// 지금 신경 쓸 일 한 행의 표준 모델.
// source: 소스 앱 구분 — '이슈'(urgency 0), '멘션'(urgency 1), '메일'(urgency 2, AI 회신 필요).
interface AttentionRow {
  key: string
  source: '이슈' | '멘션' | '메일'
  title: string
  meta: string // 우측 정렬 메타(마감/시각)
  to: string
  ariaLabel: string
  urgency: number // 작을수록 위(0=마감지남/오늘, 1=멘션, 2=회신필요메일)
  recency: number // 동일 urgency 내 최신순(epoch ms, 클수록 위)
}

// 카운트 셀 — 로딩 시 셀만 스켈레톤(격리), 에러 시 '–'.
// to 가 있으면 모듈 딥링크(Link), onClick 이 있으면 액션 버튼(예: '멘션' → 알림 패널 열기).
// ai=true 이면 AI 분류 활성 신호(🤖 배지 + text-ai-accent 강조).
function CountCell({
  label,
  count,
  to,
  onClick,
  loading,
  error,
  ai,
}: {
  label: string
  count: number
  to?: string
  onClick?: () => void
  loading: boolean
  error: boolean
  ai?: boolean
}) {
  const ariaLabel = error ? `${label} 불러오기 실패` : `${label} ${count}건`
  const className =
    'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-card px-2 py-2 text-center hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
  const inner = (
    <>
      {loading ? (
        <Skeleton className="h-6 w-8" />
      ) : (
        <span className="flex items-center gap-0.5 text-xl font-semibold text-ai-accent">
          {error ? '–' : count}
          {/* AI 분류 활성 시 🤖 배지로 AI 신호 표시(Phase 1 focus card 와 동일 토큰). */}
          {ai && !error && <span className="text-xs leading-none">🤖</span>}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{label}</span>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} className={className}>
        {inner}
      </button>
    )
  }
  return (
    <Link to={to ?? '#'} aria-label={ariaLabel} className={className}>
      {inner}
    </Link>
  )
}

// 소스별 아이콘 — 이슈(마감), 멘션(코멘트), 메일(AI 회신 필요).
const SOURCE_ICON = {
  이슈: CalendarClock,
  멘션: MessageSquare,
  메일: Mail,
} as const

/** ① 합성 레이어 — 카운트 스트립 + 지금 신경 쓸 일 리스트. 소스별 에러/로딩 격리. */
export function SynthesisLayer() {
  // '멘션' 셀 클릭 시 AppRail 의 알림 인박스 패널을 연다(전용 멘션 페이지 없음).
  const { openInbox } = useInboxPanel()

  // CTA dismiss 상태 — localStorage 영속(reload 후에도 유지). key: home.mailCta.dismissed.
  const [ctaDismissed, setCtaDismissed] = useState(
    () => localStorage.getItem('home.mailCta.dismissed') === '1',
  )
  const dismissCta = () => {
    localStorage.setItem('home.mailCta.dismissed', '1')
    setCtaDismissed(true)
  }
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

  // 메일 카운트 — AI 분류 활성이면 "회신 필요 N", 비활성이면 "안 읽음 N".
  const unreadMail = mail.data?.unreadCount ?? 0
  const needsReply = mail.data?.needsReplyCount ?? 0
  // classificationActive: 하나라도 aiEnabled 계정이 있으면 true(백엔드 집계).
  const classifyOn = mail.data?.classificationActive ?? false

  const todayEventCount = (events.data ?? []).length

  // ── 지금 신경 쓸 일 병합(클라이언트 규칙) ────────────────────────────────────
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

  // 3) 회신 필요 메일(분류 활성 + aiNeedsReply===true && 안읽음) — urgency 2.
  // pending(aiNeedsReply null)은 제외 — AI 판정 전 상태라 노이즈.
  if (!mail.isError) {
    for (const m of mail.data?.recent ?? []) {
      if (m.aiNeedsReply === true && !m.seen) {
        rows.push({
          key: `mail-${m.id}`,
          source: '메일',
          title: m.subject ?? '(제목 없음)',
          meta: '회신 필요',
          // accountId 기반 딥링크 — Task 6 가 소비.
          to: `/mail/${m.accountId}?messageId=${m.id}`,
          ariaLabel: `메일 열기: ${m.subject ?? '(제목 없음)'}`,
          urgency: 2,
          recency: parseUtcDate(m.receivedAt ?? '1970-01-01T00:00:00Z').getTime(),
        })
      }
    }
  }

  // 긴급도 우선, 동일 긴급도 내 최신순. 상위 5건.
  rows.sort((a, b) => a.urgency - b.urgency || b.recency - a.recency)
  const top = rows.slice(0, 5)

  // 카운트 셀 로딩/에러 플래그(셀 단위 격리).
  // ai=true 이면 CountCell 이 🤖 배지를 표시(AI 분류 활성 신호).
  const cells: {
    label: string
    count: number
    to?: string
    onClick?: () => void
    q: { isLoading: boolean; isError: boolean }
    ai?: boolean
  }[] = [
    { label: '오늘 마감', count: dueTodayCount, to: '/me/tasks/assigned?dueDate=today', q: dues },
    // 멘션: 전용 페이지가 없어 라우팅 대신 알림 인박스 패널을 연다(#273).
    { label: '멘션', count: mentionCount, onClick: () => openInbox(), q: notifs },
    // 메일 KPI 스왑: 분류 활성 시 "회신 필요 N"(🤖), 비활성 시 "안 읽음 N".
    classifyOn
      ? { label: '회신 필요', count: needsReply, to: '/mail', q: mail, ai: true }
      : { label: '안 읽음', count: unreadMail, to: '/mail', q: mail },
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
              onClick={c.onClick}
              loading={c.q.isLoading}
              error={c.q.isError}
              ai={c.ai}
            />
          ))}
        </div>

        {/* 지금 신경 쓸 일 — 크로스앱(이슈·멘션) 급한 것만. 최상위 1건은 포커스 카드로 강조. 비면 차분한 빈 상태. */}
        <div data-testid="dashboard-attention">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {/* 빈 상태(0건)면 경고 색 제거 — 경고 아이콘이 긍정 메시지와 모순되지 않도록. */}
            <AlertTriangle
              className={`h-4 w-4 ${top.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
            />
            지금 신경 쓸 일{top.length > 0 ? ` (${top.length})` : ''}
          </div>
          {top.length === 0 ? (
            <div
              className="flex items-center gap-2 rounded-md border border-border px-3 py-3 text-sm text-muted-foreground"
              data-testid="dashboard-attention-empty"
            >
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              다 확인했습니다
            </div>
          ) : (
            <div className="space-y-2">
              {/* 포커스 카드 — 최상위 1건을 강조(ai-accent 보더 + subtle 배경). 규칙 기반 이유 표시(AI 내레이션은 후속 Phase). */}
              {(() => {
                const f = top[0]
                const FIcon = SOURCE_ICON[f.source]
                return (
                  <Link
                    to={f.to}
                    aria-label={f.ariaLabel}
                    data-testid="dashboard-attention-focus"
                    className="flex items-center gap-3 rounded-lg border border-ai-accent bg-ai-accent-subtle px-3 py-2.5 hover:bg-ai-accent-subtle/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      <FIcon className="h-3 w-3" />
                      {f.source}
                    </span>
                    <span className="truncate text-sm font-medium">{f.title}</span>
                    <span className="ml-auto shrink-0 text-xs font-medium text-ai-accent">{f.meta}</span>
                  </Link>
                )
              })()}
              {/* 나머지 항목 — 차분한 리스트. */}
              {top.length > 1 && (
                <ul className="space-y-0.5 border-l-2 border-l-destructive pl-2">
                  {top.slice(1).map((r) => {
                    const Icon = SOURCE_ICON[r.source]
                    return (
                      <li key={r.key}>
                        <Link
                          to={r.to}
                          aria-label={r.ariaLabel}
                          className="flex min-h-6 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            <Icon className="h-3 w-3" />
                            {r.source}
                          </span>
                          <span className="truncate">{r.title}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.meta}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        {/* AI 메일 분류 CTA — 분류 OFF + dismiss 안 했을 때만 표시. localStorage 로 dismiss 영속. */}
        {!classifyOn && !ctaDismissed && (
          <div
            data-testid="dashboard-mail-cta"
            className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-ai-accent/40 bg-ai-accent-subtle/40 px-3 py-2 text-xs text-muted-foreground"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-ai-accent" />
            <span>AI로 회신이 필요한 메일을 가려낼 수 있어요</span>
            <Link to="/settings/mail" className="font-medium text-ai-accent hover:underline">
              켜기
            </Link>
            <button
              type="button"
              aria-label="닫기"
              onClick={dismissCta}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
