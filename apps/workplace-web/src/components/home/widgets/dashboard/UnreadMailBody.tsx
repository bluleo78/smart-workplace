import { Mail } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import type { MailSummaryItem } from '@/types/dashboard'

import { WidgetError } from '../WidgetError'

// 발신자 표시명 — name 우선, 없으면 주소, 둘 다 없으면 '(알 수 없음)'.
function sender(item: MailSummaryItem): string {
  return item.fromName?.trim() || item.fromAddress || '(알 수 없음)'
}

/** 안 읽은 메일 요약 본문 — 안 읽은 수 + 최근 3건. 프레임/딥링크는 Dashboard 담당. */
export default function UnreadMailBody() {
  const { data, isLoading, isError, refetch } = useMailSummary()

  if (isLoading) return <Skeleton className="h-20 w-full" />
  if (isError) return <WidgetError onRetry={() => refetch()} testId="dash-mail-error" />

  const recent = data?.recent ?? []
  const unreadCount = data?.unreadCount ?? 0

  if (recent.length === 0)
    return (
      <div
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-mail-empty"
      >
        <Mail className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">새 메일이 없어요</p>
      </div>
    )

  return (
    <div data-testid="dash-mail">
      <div className="mb-2 text-sm text-muted-foreground">안 읽음 {unreadCount}건</div>
      <ul className="space-y-1">
        {recent.slice(0, 3).map((m) => (
          <li key={m.id} className="truncate text-sm">
            <span className={m.seen ? 'text-muted-foreground' : 'font-medium'}>
              {m.subject?.trim() || '(제목 없음)'}
            </span>{' '}
            <span className="text-xs text-muted-foreground">· {sender(m)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
