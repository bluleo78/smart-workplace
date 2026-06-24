import { Hash, MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { relTime } from '@/components/ai/relTime'
import { Skeleton } from '@/components/ui/skeleton'
import { useMessagingSummary } from '@/hooks/queries/useMessagingSummary'
import type { ConversationSummaryItem } from '@/types/dashboard'

import { WidgetError } from '../WidgetError'

// 대화 딥링크 — DM 은 /chat/dms/:id, 채널은 /chat/channels/:id.
function href(c: ConversationSummaryItem): string {
  return c.kind === 'DM' ? `/chat/dms/${c.conversationId}` : `/chat/channels/${c.conversationId}`
}

// 신호 배지(우선순위: AI 발굴 > 멘션 > 회신대기 > 새 답글).
// AI 발굴은 ai-accent 시맨틱 토큰, 멘션은 violet, 회신대기는 amber, 새 답글은 sky 계열.
function Badge({ c }: { c: ConversationSummaryItem }) {
  // AI가 발굴한 암묵적 관련성 — 최우선 배지, AiSignalBadge action 변형으로 통일(reason=tooltip).
  if (c.aiReason != null)
    return (
      <AiSignalBadge variant="action" data-testid="dash-chat-badge-ai" reason={c.aiReason}>
        확인 필요
      </AiSignalBadge>
    )
  if (c.mentioned)
    return (
      <span
        data-testid="dash-chat-badge-mention"
        className="flex-none rounded-full bg-violet-100 px-1.5 text-xs font-semibold text-violet-700"
      >
        멘션
      </span>
    )
  if (c.needsReply)
    return (
      <span
        data-testid="dash-chat-badge-reply"
        className="flex-none rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700"
      >
        회신대기
      </span>
    )
  if (c.newThreadReplyCount > 0)
    return (
      <span
        data-testid="dash-chat-badge-thread"
        className="flex-none rounded-full bg-sky-100 px-1.5 text-xs font-semibold text-sky-700"
      >
        새 답글 {c.newThreadReplyCount}
      </span>
    )
  return null
}

/**
 * 대화 위젯 본문 — "내 대화 근황(recency·presence)".
 * 멘션·회신대기·새답글을 강조하며, 최근 대화 목록 상위 count 건을 보여준다.
 * 행 클릭 → 해당 DM/채널 딥링크.
 */
export default function ConversationsBody({ count = 5 }: { count?: number }) {
  const { data, isLoading, isError, refetch } = useMessagingSummary()

  // 로딩 중: 스켈레톤으로 레이아웃 유지.
  if (isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (isError) return <WidgetError onRetry={() => refetch()} testId="dash-chat-error" />

  const recent = data?.recent ?? []
  const needsReplyCount = data?.needsReplyCount ?? 0
  const unreadCount = data?.unreadConversationCount ?? 0

  // 빈 상태: 최근 대화 없음 → 조용한 메시지.
  if (recent.length === 0)
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-chat-empty"
      >
        <MessageSquare className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">조용하네요 — 새 대화가 없어요</p>
      </div>
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
        {recent.slice(0, count).map((c) => (
          <li key={`${c.kind}-${c.conversationId}`}>
            {/* 행 클릭 → DM/채널 상세 딥링크. */}
            <Link
              to={href(c)}
              data-testid="dash-chat-row"
              aria-label={`대화 열기: ${c.label}`}
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
                  <Badge c={c} />
                  <span className="ml-auto flex-none text-xs text-muted-foreground">
                    {c.lastMessageAt ? relTime(c.lastMessageAt) : ''}
                  </span>
                </span>
                {/* 미리보기: "발신자: 내용" 형식. */}
                <span className="block truncate text-xs text-muted-foreground">
                  {c.lastAuthorName ? `${c.lastAuthorName}: ` : ''}
                  {c.lastMessagePreview}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
