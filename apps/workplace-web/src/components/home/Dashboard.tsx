// 고정 홈 대시보드 — 사용자 저장 레이아웃 순서로 위젯을 렌더한다.
// AI compose 캔버스 대신 레지스트리 기반 위젯 그리드를 표시(중간 시각 구현).
import { Suspense } from 'react'
import { Link } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardLayout } from '@/hooks/queries/useDashboard'

import { getDashboardWidget, type DashboardWidget } from './widgets/registry'

/** 위젯 한 칸 — 카드 프레임(헤더 클릭 시 딥링크) + 격리된 본문. */
function WidgetCard({ widget }: { widget: DashboardWidget }) {
  const { title, icon: Icon, Component, deepLink } = widget
  return (
    <Card className="border-l-2 border-l-ai-accent" data-testid="dashboard-widget">
      <CardHeader className="pb-2">
        {/* 제목/아이콘 클릭 시 해당 모듈로 이동(딥링크). */}
        <Link
          to={deepLink}
          className="flex items-center gap-2 text-muted-foreground hover:text-ai-accent"
        >
          <Icon className="h-4 w-4" />
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </Link>
      </CardHeader>
      <CardContent>
        {/* 본문 lazy 로드 — 위젯별 스켈레톤으로 폴백(격리). */}
        <Suspense fallback={<Skeleton className="h-20 w-full" />}>
          <Component />
        </Suspense>
      </CardContent>
    </Card>
  )
}

/** 레이아웃 로딩 중 스켈레톤 그리드. */
function DashboardSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="dashboard-skeleton"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  )
}

/** 홈 대시보드 — 저장 레이아웃을 위젯 정의로 매핑(알 수 없는 키는 무시) 후 반응형 그리드 렌더. */
export function Dashboard() {
  const { data, isLoading } = useDashboardLayout()

  if (isLoading) return <DashboardSkeleton />

  // 알 수 없는/제거된 키는 조용히 스킵.
  const widgets = (data?.widgets ?? [])
    .map(getDashboardWidget)
    .filter((w): w is DashboardWidget => w !== null)

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="dashboard">
        {widgets.map((w) => (
          <WidgetCard key={w.type} widget={w} />
        ))}
      </div>
    </div>
  )
}
