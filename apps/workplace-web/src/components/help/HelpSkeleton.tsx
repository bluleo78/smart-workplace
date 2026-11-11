// 도움말 받는 중 자리(WP-1505) — 본문 자리 줄 몇 개. 패널 본체(HelpPanel)를 불러오는 동안(LazyHelpPanel)과
// 묶음 파일을 받는 동안(HelpPanel) 둘 다 이것을 보인다 — 셸 청크에 두려고 HelpPanel 과 따로 둔다.
import { Skeleton } from '@/components/ui/skeleton'

/** 받는 중 — 본문 자리 줄 몇 개. */
export function HelpSkeleton() {
  return (
    <div data-testid="help-loading" className="space-y-2 px-4 py-3" aria-hidden>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}
