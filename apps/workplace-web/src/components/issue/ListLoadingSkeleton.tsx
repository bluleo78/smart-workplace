// 작업 목록 첫 로딩 스켈레톤(WP-919) — 내 작업(InfiniteIssueList)·AI 위임 작업이 함께 쓴다(DS 06 §A-2).
// 데스크톱은 표 자리를 TableSkeletonRows 로, 모바일(<1024px)은 실제 모바일 행 모양(상태 아이콘 + 제목 줄 + 메타 줄)으로 그린다 —
// 모바일에 4열 표 모양을 두면 불러온 뒤 2줄 행으로 바뀌며 화면이 크게 출렁인다.
import { Skeleton } from '@/components/ui/skeleton'
import { TableSkeletonRows } from '@/components/ui/table-skeleton'
import { useIsMobile } from '@/hooks/useIsMobile'

/** label — 보조기기에 알릴 「무엇을 불러오는 중」. */
export function ListLoadingSkeleton({ label }: { label: string }) {
  const isMobile = useIsMobile()
  if (isMobile)
    return (
      <ul aria-busy="true" aria-label={label} data-testid="list-loading-skeleton">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-start gap-2 row-divider px-1 py-2.5">
            <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </li>
        ))}
      </ul>
    )
  // 제목 자리는 고정 폭(w-80) — 자동 레이아웃 표에서 w-full 은 칸 폭이 정해지지 않아 짧은 막대로 줄어든다.
  return (
    <table className="w-full" aria-busy="true" aria-label={label} data-testid="list-loading-skeleton">
      <tbody>
        <TableSkeletonRows columns={4} rows={5} widths={['w-4', 'w-20', 'w-80', 'w-16']} />
      </tbody>
    </table>
  )
}
