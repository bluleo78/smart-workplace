import { Hash, MessageSquare } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router-dom'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { relTime } from '@/components/ai/relTime'
import { Skeleton } from '@/components/ui/skeleton'
import { useMessagingSummary } from '@/hooks/queries/useMessagingSummary'
import { showsLoadError } from '@/lib/queryFailure'
import type { ConversationSummaryItem } from '@/types/dashboard'

import { WidgetError } from '../WidgetError'
import { WidgetEmptyState } from './WidgetEmptyState'

// 대화 딥링크 — DM 은 /chat/dms/:id, 채널은 /chat/channels/:id.
function href(c: ConversationSummaryItem): string {
  return c.kind === 'DM' ? `/chat/dms/${c.conversationId}` : `/chat/channels/${c.conversationId}`
}

// 신호 배지 종류 — 우선순위(AI 발굴 > 멘션 > 회신대기 > 새 답글)의 단일 원본. null 이면 배지가 없다.
// WP-1899: Badge 렌더와 배지 설명 id 참조 여부가 같은 판정을 쓰도록 한 곳에 둔다.
type BadgeKind = 'ai' | 'mention' | 'reply' | 'thread'
function badgeKind(c: ConversationSummaryItem): BadgeKind | null {
  if (c.aiReason != null) return 'ai'
  if (c.mentioned) return 'mention'
  if (c.needsReply) return 'reply'
  if (c.newThreadReplyCount > 0) return 'thread'
  return null
}

// 신호 배지(우선순위: AI 발굴 > 멘션 > 회신대기 > 새 답글).
// AI 발굴은 ai-accent 시맨틱 토큰, 멘션은 primary, 회신대기는 amber, 새 답글은 sky 계열.
// id: 접근 설명(aria-describedby) 참조용 — 어느 분기든 root 요소에 단다(WP-1899).
function Badge({ c, id }: { c: ConversationSummaryItem; id?: string }) {
  switch (badgeKind(c)) {
    // AI가 발굴한 암묵적 관련성 — 최우선 배지, AiSignalBadge action 변형으로 통일(reason=tooltip).
    case 'ai':
      return (
        <AiSignalBadge id={id} variant="action" data-testid="dash-chat-badge-ai" reason={c.aiReason ?? undefined}>
          확인 필요
        </AiSignalBadge>
      )
    case 'mention':
      return (
        <span
          id={id}
          data-testid="dash-chat-badge-mention"
          className="flex-none rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary"
        >
          멘션
        </span>
      )
    case 'reply':
      return (
        <span
          id={id}
          data-testid="dash-chat-badge-reply"
          className="flex-none rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700"
        >
          회신대기
        </span>
      )
    case 'thread':
      return (
        <span
          id={id}
          data-testid="dash-chat-badge-thread"
          className="flex-none rounded-full bg-sky-100 px-1.5 text-xs font-semibold text-sky-700"
        >
          새 답글 {c.newThreadReplyCount}
        </span>
      )
    default:
      return null
  }
}

/**
 * 대화 위젯 본문 — "내 대화 근황(recency·presence)".
 * 멘션·회신대기·새답글을 강조하며, 최근 대화 목록 상위 count 건을 보여준다.
 * 행 클릭 → 해당 DM/채널 딥링크.
 */
export default function ConversationsBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: ConversationSummaryItem[]
}) {
  // WP-1899: 행 설명 id 접두 — 훅 규칙상 early return 전에 둔다.
  const base = useId()
  const query = useMessagingSummary({ enabled: !previewData })
  const { data, isLoading, refetch } = query

  // 실패 안내는 로딩보다 먼저 본다 — 다시 부르는 동안에도 안내를 그대로 둬야 다시 시도의 초점이 남는다(WP-881).
  if (!previewData && showsLoadError(query))
    return <WidgetError onRetry={() => refetch()} retrying={query.isFetching} testId="dash-chat-error" />
  // 로딩 중: 스켈레톤으로 레이아웃 유지.
  if (!previewData && isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )

  const recent = previewData ?? data?.recent ?? []
  const needsReplyCount = previewData ? previewData.filter((c) => c.needsReply).length : (data?.needsReplyCount ?? 0)
  const unreadCount = previewData
    ? previewData.filter((c) => c.unreadCount > 0).length
    : (data?.unreadConversationCount ?? 0)

  // 빈 상태: 최근 대화 없음 → 설명 + 다음 행동(새 대화) CTA. 빈 상태는 늘 CTA 를 둔다(WP-1853).
  if (recent.length === 0)
    return (
      <WidgetEmptyState
        icon={MessageSquare}
        title="조용하네요 — 새 대화가 없어요"
        description="새 메시지가 오면 여기에 모여요"
        cta={{ label: '새 대화', to: '/chat/new' }}
        testId="dash-chat-empty"
      />
    )

  return (
    <div data-testid="dash-chat">
      {/* 헤더 집계 — 회신 대기(강조) · 안읽음. 메일 위젯과 동일한 "A · B" 형태(text-sm). */}
      <div className="mb-2 text-sm text-muted-foreground" data-testid="dash-chat-hint">
        {needsReplyCount > 0 ? (
          <>
            <span className="font-medium text-ai-accent">회신 대기 {needsReplyCount}</span> · 안읽음{' '}
            {unreadCount}
          </>
        ) : (
          <>안읽음 {unreadCount}</>
        )}
      </div>
      <ul className="space-y-0.5">
        {recent.slice(0, count).map((c) => {
          // WP-1899: 이름(aria-label)은 대화명만 짧게 두고, 보이는 보조 정보는 aria-describedby 로 이어 설명으로 읽힌다.
          // 순서는 화면 읽기 순서(배지 → 시간 → 미리보기). 늘 그리는 span 은 id 를 늘 달고, 내용이 없으면 설명에 잇지만 않는다.
          const rowId = `${base}-${c.kind}-${c.conversationId}`
          const badgeId = `${rowId}-badge`
          const previewId = `${rowId}-preview`
          const timeId = `${rowId}-time`
          const hasPreview = !!(c.lastAuthorName || c.lastMessagePreview)
          const describedBy = [badgeKind(c) !== null && badgeId, c.lastMessageAt && timeId, hasPreview && previewId]
            .filter(Boolean)
            .join(' ')
          return (
            <li key={`${c.kind}-${c.conversationId}`}>
              {/* 행 클릭 → DM/채널 상세 딥링크. */}
              <Link
                to={href(c)}
                data-testid="dash-chat-row"
                aria-label={`대화 열기: ${c.label}`}
                aria-describedby={describedBy || undefined}
                className="flex gap-2 rounded px-1 py-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {/* DM: 이름 첫 글자 아바타 / 채널: # 아이콘(ai-accent 배경). */}
                {c.kind === 'DM' ? (
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {c.label.charAt(0)}
                  </span>
                ) : (
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-ai-accent/10 text-ai-accent">
                    <Hash className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{c.label}</span>
                    {/* WP-1899: 배지 root 에 id 를 직접 단다 — 감싸는 요소 없이 레이아웃 그대로. 배지가 없으면 id 도 없다. */}
                    <Badge c={c} id={badgeId} />
                    <span id={timeId} className="ml-auto flex-none text-xs text-muted-foreground">
                      {c.lastMessageAt ? relTime(c.lastMessageAt) : ''}
                    </span>
                  </span>
                  {/* 미리보기: "발신자: 내용" 형식. */}
                  <span id={previewId} className="block truncate text-xs text-muted-foreground">
                    {c.lastAuthorName ? `${c.lastAuthorName}: ` : ''}
                    {c.lastMessagePreview}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
