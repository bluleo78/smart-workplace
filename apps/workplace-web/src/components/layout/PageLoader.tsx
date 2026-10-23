import { Skeleton } from '@/components/ui/skeleton'

/** 화면을 불러오는 동안의 자리 표시 — 라우트 lazy 로딩(Suspense)과 404 화면의 새 버전 확인(WP-872)이 같이 쓴다. */
export function PageLoader() {
  return (
    <div className="container mx-auto p-8">
      <Skeleton className="h-8 w-48 mb-4" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
