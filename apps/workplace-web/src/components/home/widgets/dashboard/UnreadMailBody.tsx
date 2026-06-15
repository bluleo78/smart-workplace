import { Mail } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import type { MailSummaryItem } from '@/types/dashboard'

import { WidgetError } from '../WidgetError'

// 발신자 표시명 — name 우선, 없으면 주소, 둘 다 없으면 '(알 수 없음)'.
function sender(item: MailSummaryItem): string {
  return item.fromName?.trim() || item.fromAddress || '(알 수 없음)'
}

/** 안 읽은 메일 요약 본문 — 안 읽은 수 + 최근 3건. 프레임/딥링크는 Dashboard 담당. */
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

  if (recent.length === 0)
    return (
      <div
        // I3(a11y): 빈 상태 role="status".
        role="status"
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
      <ul className="space-y-0.5">
        {recent.slice(0, count).map((m) => (
          // 메시지 전용 상세 라우트/계정 식별자가 없어 메일함(/mail)으로 딥링크(스펙 §1.3 허용 폴백).
          <li key={m.id}>
            <Link
              to="/mail"
              aria-label={`메일 열기: ${m.subject?.trim() || '(제목 없음)'}`}
              className="flex min-h-6 items-center rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="truncate">
                <span className={m.seen ? 'text-muted-foreground' : 'font-medium'}>
                  {m.subject?.trim() || '(제목 없음)'}
                </span>{' '}
                <span className="text-xs text-muted-foreground">· {sender(m)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
