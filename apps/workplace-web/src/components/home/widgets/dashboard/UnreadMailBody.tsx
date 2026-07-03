import { Mail, Paperclip } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { relTime } from '@/components/ai/relTime'
import { Skeleton } from '@/components/ui/skeleton'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import type { MailSummaryItem } from '@/types/dashboard'

import { WidgetError } from '../WidgetError'

// 발신자 표시명 — name 우선, 없으면 주소, 둘 다 없으면 '(알 수 없음)'.
function sender(item: MailSummaryItem): string {
  return item.fromName?.trim() || item.fromAddress || '(알 수 없음)'
}

// 아바타 이니셜 — 발신자명 첫 글자.
function initial(item: MailSummaryItem): string {
  return sender(item).charAt(0)
}

/**
 * 안 읽은 메일 위젯 — "회신 의무로 분류한 받은편지함 엿보기".
 * 회신필요(aiNeedsReply) 먼저 → 최신순. 발신자·제목·미리보기·시각·배지/첨부.
 * 행 클릭 = 해당 메일 딥링크(/mail/{accountId}?messageId={id}) — MailInboxPage 가
 * ?messageId 를 읽어 상세 패널을 자동으로 연다(#447). 헤더/프레임은 Dashboard 담당.
 */
export default function UnreadMailBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: MailSummaryItem[]
}) {
  const { data: queryData, isLoading, isError, refetch } = useMailSummary({ enabled: !previewData })
  // "회신 필요" 토글 — 켜면 aiNeedsReply 메일만 필터(헤더 칩 클릭). 위젯 로컬 상태.
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false)

  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (!previewData && isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (!previewData && isError) return <WidgetError onRetry={() => refetch()} testId="dash-mail-error" />

  const recent = previewData ?? queryData?.recent ?? []
  const unreadCount = previewData ? previewData.filter((m) => !m.seen).length : (queryData?.unreadCount ?? 0)
  const needsReplyCount = previewData ? previewData.filter((m) => m.aiNeedsReply && !m.needsReplyDoneAt).length : (queryData?.needsReplyCount ?? 0)
  const classificationActive = previewData ? true : (queryData?.classificationActive ?? false)

  if (recent.length === 0)
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-mail-empty"
      >
        <Mail className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">새 메일이 없어요</p>
      </div>
    )

  // 회신필요(분류 활성 시) 먼저 → 최신순. receivedAt nullsLast.
  const rows = [...recent].sort((a, b) => {
    if (classificationActive) {
      const ar = a.aiNeedsReply ? 1 : 0
      const br = b.aiNeedsReply ? 1 : 0
      if (ar !== br) return br - ar
    }
    const at = a.receivedAt ? new Date(a.receivedAt).getTime() : -Infinity
    const bt = b.receivedAt ? new Date(b.receivedAt).getTime() : -Infinity
    return bt - at
  })

  // P2: 통일 술어 — 처리완료(needsReplyDoneAt) 된 회신필요는 제외.
  // 토글 켜짐 → 회신 필요(미처리)만. recent 는 회신필요 우선 정렬이라 상단부터 채워진다.
  const visible = needsReplyOnly ? rows.filter((m) => m.aiNeedsReply && !m.needsReplyDoneAt) : rows

  return (
    <div data-testid="dash-mail">
      <div className="mb-2 text-sm text-muted-foreground" data-testid="dash-mail-hint">
        {classificationActive && needsReplyCount > 0 ? (
          <>
            {/* 회신 필요 칩 = 필터 토글. 활성 시 ai-accent 채움으로 "필터 켜짐" 표시. */}
            <button
              type="button"
              onClick={() => setNeedsReplyOnly((v) => !v)}
              aria-pressed={needsReplyOnly}
              data-testid="dash-mail-filter"
              className={`rounded px-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                needsReplyOnly
                  ? 'bg-ai-accent text-ai-accent-foreground'
                  : 'text-ai-accent hover:bg-ai-accent/10'
              }`}
            >
              회신 필요 {needsReplyCount}
            </button>{' '}
            · 안읽음 {unreadCount}
          </>
        ) : (
          <>안읽음 {unreadCount}</>
        )}
      </div>
      <ul className="space-y-0.5">
        {visible.slice(0, count).map((m) => (
          <li key={m.id}>
            <Link
              to={`/mail/${m.accountId}?messageId=${m.id}`}
              data-testid="dash-mail-row"
              aria-label={`메일 열기: ${m.subject?.trim() || '(제목 없음)'}`}
              className="flex gap-2 rounded px-1 py-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-xs font-medium">
                {initial(m)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{sender(m)}</span>
                  {/* 회신필요 배지 — AI action 스타일(빨강 제거). 비-AI 멘션/회신대기 배지와 시각적으로 구분. */}
                  {classificationActive && m.aiNeedsReply && (
                    <AiSignalBadge variant="action" data-testid="dash-mail-badge-reply">
                      회신필요
                    </AiSignalBadge>
                  )}
                  <span className="ml-auto flex-none text-xs text-muted-foreground">
                    {m.receivedAt ? relTime(m.receivedAt) : ''}
                  </span>
                </span>
                <span className="block truncate text-sm text-foreground/90">
                  {m.subject?.trim() || '(제목 없음)'}
                </span>
                <span className="flex items-center gap-1">
                  <span className="block min-w-0 truncate text-xs text-muted-foreground">
                    {m.snippet?.trim() || ''}
                  </span>
                  {m.hasAttachment && (
                    <Paperclip className="h-3 w-3 flex-none text-muted-foreground" />
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
