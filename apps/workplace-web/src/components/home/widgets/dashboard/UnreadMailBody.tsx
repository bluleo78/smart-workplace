import { Mail, Paperclip } from 'lucide-react'
import { Link } from 'react-router-dom'

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
 * 프레임/딥링크(/mail)는 Dashboard 담당. per-message 라우트가 없어 행 클릭=/mail.
 */
export default function UnreadMailBody({ count = 5 }: { count?: number }) {
  const { data, isLoading, isError, refetch } = useMailSummary()

  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (isError) return <WidgetError onRetry={() => refetch()} testId="dash-mail-error" />

  const recent = data?.recent ?? []
  const unreadCount = data?.unreadCount ?? 0
  const needsReplyCount = data?.needsReplyCount ?? 0
  const classificationActive = data?.classificationActive ?? false

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

  return (
    <div data-testid="dash-mail">
      <div className="mb-2 text-xs text-muted-foreground" data-testid="dash-mail-hint">
        {classificationActive ? (
          <>
            <span className="font-medium text-ai-accent">회신 필요 {needsReplyCount}</span> ·
            안읽음 {unreadCount}
          </>
        ) : (
          <>안읽음 {unreadCount}</>
        )}
      </div>
      <ul className="space-y-0.5">
        {rows.slice(0, count).map((m) => (
          <li key={m.id}>
            <Link
              to="/mail"
              data-testid="dash-mail-row"
              aria-label={`메일 열기: ${m.subject?.trim() || '(제목 없음)'}`}
              className="flex gap-2 rounded px-1 py-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                {initial(m)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{sender(m)}</span>
                  {classificationActive && m.aiNeedsReply && (
                    <span
                      data-testid="dash-mail-badge-reply"
                      className="flex-none rounded-full bg-red-100 px-1.5 text-[10px] font-semibold text-red-600"
                    >
                      회신필요
                    </span>
                  )}
                  <span className="ml-auto flex-none text-[11px] text-muted-foreground">
                    {m.receivedAt ? relTime(m.receivedAt) : ''}
                  </span>
                </span>
                <span className="block truncate text-[13px] text-foreground/90">
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
