import { pageBodyInsetClass, pageReadingWidthClass } from '@/components/layout/Page'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * 노트 페이지 skeleton — DS §2.5. 페이지 로딩(WikiPageView)과 동기화 첫 연결 전 본문(WikiEditor, WP-287)이 같이 쓴다.
 * withTitle=false 면 본문 줄만 — 제목은 REST 로 이미 왔으므로 입력란을 그대로 두고 본문 자리만 채운다.
 */
export function WikiPageSkeleton({ withTitle = true, testId }: { withTitle?: boolean; testId: string }) {
  const lines = (
    <>
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-2 h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
    </>
  )
  if (!withTitle) return <div data-testid={testId} aria-busy="true" aria-label="본문 불러오는 중">{lines}</div>
  return (
    <div className={cn(pageBodyInsetClass, pageReadingWidthClass)} data-testid={testId}>
      <Skeleton className="mb-4 h-9 w-64" />
      {lines}
    </div>
  )
}
