// ① 합성 레이어 — 게이트 §1.1. 클라이언트 단순·설명가능 규칙으로
// 이미 받아온 위젯 데이터를 재가공한다(새 백엔드·AI 없음).
//   - 상태 카운트 스트립: 오늘 마감 · @멘션 · 안 읽음(또는 회신 필요) · 오늘 일정 (각 셀 = 모듈 딥링크)
//   - 지금 신경 쓸 일: 크로스앱 급한 것만(마감 지난/오늘 + 멘션 + 회신 필요 메일), 최상위 포커스 카드 + 행 딥링크
// 페치 정책: notifications·mail·calendar 훅은 ③ 위젯 바디와 동일 키 → TanStack Query 가 dedupe(이중 페치 없음).
//   단 useMyIssueDues 는 어느 ③ 바디도 쓰지 않는 합성 전용 추가 쿼리다(마감 마커 — 스펙 허용).
import { AlertTriangle, CalendarClock, CheckCircle2, Mail, MessageCircle, MessageSquare, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { PriorityItem } from '@/api/priorityItems'
import { AiContent } from '@/components/ai/AiContent'
import { useInboxPanel } from '@/components/layout/InboxContext'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import { useMessagingSummary } from '@/hooks/queries/useMessagingSummary'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { flattenNotificationPages, useNotifications } from '@/hooks/queries/useNotifications'
import { usePriorityItems } from '@/hooks/queries/usePriorityItems'
import { parseUtcDate } from '@/lib/formatters'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'
import type { MailSummary, MessagingSummary } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { isMentionLike, notifLabel, notifTarget } from '../notifTarget'

// 위젯 추가 모달 프리뷰 전용(#브레인스토밍 2026-07-03) — 6개 하위 훅 각각의 응답을 그대로 미러링한
// 목데이터 뭉치. previewData 가 있으면 6개 훅 전부 enabled:false 로 끄고 이 값으로만 렌더한다.
export interface SynthesisPreviewData {
  dues: IssueDueMarker[]
  notifications: NotificationResponse[]
  mail: MailSummary
  events: CalendarEvent[]
  messaging: MessagingSummary
  priorityItems: PriorityItem[]
}

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
// source: 소스 앱 구분 — '이슈'(urgency 0), '멘션'·'메시지'(urgency 1), '메일'(urgency 2, AI 회신 필요).
// isAi: AI 발굴 신호 — meta 를 text-ai-accent 로 강조 표시.
interface AttentionRow {
  key: string
  source: '이슈' | '멘션' | '메일' | '메시지'
  title: string
  meta: string // 우측 정렬 메타(마감/시각)
  to: string
  ariaLabel: string
  urgency: number // 작을수록 위(0=마감지남/오늘, 1=멘션·메시지, 2=회신필요메일)
  recency: number // 동일 urgency 내 최신순(epoch ms, 클수록 위)
  isAi?: boolean // AI 발굴 신호(메시지 aiReason, 메일 aiNeedsReply)
  aiScore: number | null // AI 배치 점수합산(없으면 null, 정렬 시 urgency 폴백)
}

// 카운트 셀 — 로딩 시 셀만 스켈레톤(격리), 에러 시 '–'.
// to 가 있으면 모듈 딥링크(Link), onClick 이 있으면 액션 버튼(예: '멘션' → 알림 패널 열기).
// ai=true 이면 AI 분류 활성 신호(Sparkles 배지 + text-ai-accent 강조).
// testId: data-testid 속성 전달(E2E 셀 단위 검증용).
function CountCell({
  label,
  count,
  to,
  onClick,
  loading,
  error,
  ai,
  testId,
}: {
  label: string
  count: number
  to?: string
  onClick?: () => void
  loading: boolean
  error: boolean
  ai?: boolean
  testId?: string
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
          {/* AI 분류 활성 시 Sparkles 아이콘으로 AI 신호 표시 — 이모지 대신 lucide 아이콘(ai-accent 토큰). */}
          {ai && !error && <Sparkles className="inline h-3 w-3 text-ai-accent" />}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{label}</span>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} data-testid={testId} className={className}>
        {inner}
      </button>
    )
  }
  return (
    <Link to={to ?? '#'} aria-label={ariaLabel} data-testid={testId} className={className}>
      {inner}
    </Link>
  )
}

// 소스별 아이콘 — 이슈(마감), 멘션(코멘트), 메일(AI 회신 필요), 메시지(DM/채널 대화).
// 메시지는 MessageCircle 로 멘션(MessageSquare) 과 구분.
const SOURCE_ICON = {
  이슈: CalendarClock,
  멘션: MessageSquare,
  메일: Mail,
  메시지: MessageCircle,
} as const

/** ① 합성 레이어 — 카운트 스트립 + 지금 신경 쓸 일 리스트. 소스별 에러/로딩 격리. */
export function SynthesisLayer({ previewData }: { previewData?: SynthesisPreviewData } = {}) {
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
  const dues = useMyIssueDues(dueFrom.toISOString(), to, { enabled: !previewData })

  // 멘션(코멘트 프록시) — 알림 목록 재사용(위젯과 동일 키 → dedupe).
  const notifs = useNotifications(!previewData)
  // 안 읽은 메일 — 카운트 + 최근(중요 메일 추출).
  const mail = useMailSummary({ enabled: !previewData })
  // 오늘 일정.
  const events = useCalendarEvents(from, to, { enabled: !previewData })
  // 메시징 요약 — 회신대기 + AI 발굴 대화 카운트·recent 목록(홈 위젯과 동일 키 → TanStack Query dedupe).
  const messaging = useMessagingSummary({ enabled: !previewData })

  // AI 우선순위 점수(15분 배치) — sourceType+sourceId 로 매칭해 정렬 키로 사용. 아직 배치가 못 돈
  // 신규 후보는 매칭이 안 되므로 기존 소스 고정 순위로 폴백(정렬 실패로 전체가 깨지지 않도록 방어).
  const priority = usePriorityItems({ enabled: !previewData })
  const priorityItems: PriorityItem[] = previewData?.priorityItems ?? priority.data?.items ?? []
  const priorityScoreOf = (sourceType: string, sourceId: string): number | null => {
    const match = priorityItems.find((i) => i.sourceType === sourceType && i.sourceId === sourceId)
    return match ? match.importanceScore + match.urgencyScore : null
  }

  // ── 카운트 산출(소스별 에러/로딩 격리, previewData 있으면 항상 로딩/에러 없음) ──────────
  const dueItems: IssueDueMarker[] = previewData?.dues ?? dues.data ?? []
  const dueTodayCount = dueItems.filter((d) => d.dueDate === todayKey).length

  // 합성 레이어도 첫 페이지(최근 20건)만 필요 — 무한스크롤은 InboxPanel 담당(#610).
  const notifItems: NotificationResponse[] =
    previewData?.notifications ?? flattenNotificationPages(notifs.data?.pages)
  const mentionCount = notifItems.filter((n) => isMentionLike(n) && !n.read).length

  const mailData = previewData?.mail ?? mail.data
  // 메일 카운트 — AI 분류 활성이면 "회신 필요 N", 비활성이면 "안 읽음 N".
  const unreadMail = mailData?.unreadCount ?? 0
  const needsReply = mailData?.needsReplyCount ?? 0
  // classificationActive: 하나라도 aiEnabled 계정이 있으면 true(백엔드 집계).
  const classifyOn = mailData?.classificationActive ?? false

  const todayEventCount = (previewData?.events ?? events.data ?? []).length

  const messagingData = previewData?.messaging ?? messaging.data
  // 메시징 KPI: 회신대기 ∪ AI 발굴(여전히 안읽음)의 합집합 dedup 카운트 → "확인 필요 N".
  // (needsReplyCount + aiAttentionCount 단순 합산은 한 채널이 두 신호를 모두 가질 때 이중 집계됨 → 백엔드 attentionCount 단일값 사용.)
  const chatNeedsAttention = messagingData?.attentionCount ?? 0

  // ── 지금 신경 쓸 일 병합(클라이언트 규칙) ────────────────────────────────────
  const rows: AttentionRow[] = []

  // 1) 마감 지남/오늘 이슈 — urgency 0.
  if (previewData || !dues.isError) {
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
          aiScore: priorityScoreOf('ISSUE_DUE', String(d.issueId)),
        })
      }
    }
  }

  // 2) @멘션(안 읽은 COMMENTED) — urgency 1.
  if (previewData || !notifs.isError) {
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
          aiScore: priorityScoreOf('MENTION', String(n.id)),
        })
      }
    }
  }

  // 3) 회신 필요 메일(분류 활성 + aiNeedsReply===true && 안읽음) — urgency 2.
  // pending(aiNeedsReply null)은 제외 — AI 판정 전 상태라 노이즈.
  if (previewData || !mail.isError) {
    for (const m of mailData?.recent ?? []) {
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
          aiScore: priorityScoreOf('MAIL_NEEDS_REPLY', String(m.id)),
        })
      }
    }
  }

  // 4) 메시징 어텐션 대화 — urgency 1(멘션과 동렬, recency 로 교차 정렬).
  // 필터: 멘션·회신대기·AI발굴·새 스레드 답글 중 하나라도 있는 것만.
  if (previewData || !messaging.isError) {
    for (const c of messagingData?.recent ?? []) {
      const isAttention =
        c.mentioned || c.needsReply || c.aiReason != null || c.newThreadReplyCount > 0
      if (!isAttention) continue

      // meta: 신호 우선순위(AI발굴 > 멘션 > 회신 > 새 답글).
      const meta =
        c.aiReason != null
          ? '확인 필요'
          : c.mentioned
            ? '멘션'
            : c.needsReply
              ? '회신'
              : `새 답글 ${c.newThreadReplyCount}`

      rows.push({
        key: `chat-${c.conversationId}`,
        source: '메시지',
        title: c.label,
        meta,
        // DM은 /chat/dms/:id, 채널은 /chat/channels/:id 딥링크.
        to: c.kind === 'DM' ? `/chat/dms/${c.conversationId}` : `/chat/channels/${c.conversationId}`,
        ariaLabel: `대화 열기: ${c.label}`,
        urgency: 1,
        recency: c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0,
        isAi: c.aiReason != null,
        aiScore: priorityScoreOf('MESSAGE_ATTENTION', String(c.conversationId)),
      })
    }
  }

  // 긴급도 우선, 동일 긴급도 내 최신순 — 이었던 기존 규칙을 AI 점수합산 내림차순(동점/미매칭 시 기존
  // urgency 폴백 → recency)으로 교체. aiScore 가 둘 다 있으면 그것으로, 하나라도 null 이면 기존 규칙.
  rows.sort((a, b) => {
    if (a.aiScore != null && b.aiScore != null) {
      return b.aiScore - a.aiScore || b.recency - a.recency
    }
    return a.urgency - b.urgency || b.recency - a.recency
  })
  const top = rows.slice(0, 5)

  // 카운트 셀 로딩/에러 플래그(셀 단위 격리). previewData 있으면 항상 로딩/에러 없음으로 고정.
  // ai=true 이면 CountCell 이 Sparkles 배지를 표시(AI 분류 활성 신호).
  // testId: E2E 셀 단위 testid(선택적).
  const noQuery = { isLoading: false, isError: false }
  const cells: {
    label: string
    count: number
    to?: string
    onClick?: () => void
    q: { isLoading: boolean; isError: boolean }
    ai?: boolean
    testId?: string
  }[] = [
    { label: '오늘 마감', count: dueTodayCount, to: '/me/tasks/assigned?dueDate=today', q: previewData ? noQuery : dues },
    // 멘션: 전용 페이지가 없어 라우팅 대신 알림 인박스 패널을 연다(#273).
    { label: '멘션', count: mentionCount, onClick: () => openInbox(), q: previewData ? noQuery : notifs },
    // 메일 KPI 스왑: 분류 활성 시 "회신 필요 N"(Sparkles), 비활성 시 "안 읽음 N".
    classifyOn
      ? { label: '회신 필요', count: needsReply, to: '/mail', q: previewData ? noQuery : mail, ai: true }
      : { label: '안 읽음', count: unreadMail, to: '/mail', q: previewData ? noQuery : mail },
    { label: '오늘 일정', count: todayEventCount, to: '/calendar', q: previewData ? noQuery : events },
    // 메시징 KPI — 회신대기 + AI 발굴 합산. AI 신호 배지 표시. 딥링크: /chat.
    { label: '확인 필요', count: chatNeedsAttention, to: '/chat', q: previewData ? noQuery : messaging, ai: true, testId: 'kpi-messaging' },
  ]

  return (
    // 합성 레이어 카드 — 규칙 기반 집계이므로 외부 카드는 표준 Card. AI 발굴 행은 포커스 카드 내 AiContent 로 마킹.
    <Card data-testid="dashboard-synthesis">
      <CardContent className="space-y-4 pt-4">
        {/* 상태 카운트 스트립 — 5셀(이슈·멘션·메일·일정·메시징), 각 셀 모듈 딥링크. */}
        <div className="grid grid-cols-5 gap-4" data-testid="dashboard-counts">
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
              testId={c.testId}
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
              {/* 포커스 카드 — 최상위 1건 강조. AI 발굴(isAi)이면 AiContent 아우라로 마킹, 아니면 표준 ai-accent 보더. */}
              {(() => {
                const f = top[0]
                const FIcon = SOURCE_ICON[f.source]
                const linkEl = (
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
                // AI 발굴 신호가 있을 때만 AiContent 아우라 추가(aiReason 이 있는 대화 행).
                return f.isAi ? (
                  <AiContent label="AI 발굴" data-testid="dashboard-synthesis-ai-focus">
                    {linkEl}
                  </AiContent>
                ) : linkEl
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
                          {/* AI 발굴 신호 행은 meta 를 ai-accent 로 강조. */}
                          <span className={`ml-auto shrink-0 text-xs ${r.isAi ? 'text-ai-accent' : 'text-muted-foreground'}`}>{r.meta}</span>
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
        {/* CTA 테두리 가시성 상향 — border-ai-accent/40 → /70 으로 대비 강화. */}
        {!classifyOn && !ctaDismissed && (
          <div
            data-testid="dashboard-mail-cta"
            className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-ai-accent/70 bg-ai-accent-subtle/40 px-3 py-2 text-xs text-muted-foreground"
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
