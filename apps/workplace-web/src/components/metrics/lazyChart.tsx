/**
 * 지연 로딩 차트 껍데기 공장 (WP-1822). TrendChart·StackedBarChart 가 같은 껍데기를 쓴다.
 * Recharts 는 impl 로 미뤄 lazy 로 불러 메인·개요 청크에 섞이지 않게 하고,
 * 빈 데이터는 impl 을 부르지 않고 「데이터 없음」으로 끝낸다(불필요한 청크 다운로드 방지).
 * 이 파일은 recharts 를 가져오지 않는다 — impl 은 load 콜백 안에서만 동적 import 된다.
 */
import { type ComponentType, lazy, Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { hasAnyValue } from './chartData'
import { type BaseChartProps, DEFAULT_CHART_HEIGHT } from './chartTypes'

/** load(동적 import)로 impl 을 늦게 불러오는 껍데기 컴포넌트를 만든다. 호출자가 제네릭 시그니처로 한 번 단언해 내보낸다. */
export function makeLazyChart<P extends BaseChartProps<unknown>>(load: () => Promise<{ default: ComponentType<P> }>) {
  const Impl = lazy(load)
  return function LazyChart(props: P) {
    const h = props.height ?? DEFAULT_CHART_HEIGHT
    if (!hasAnyValue(props.data, props.series)) {
      return (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ width: props.width, height: h }}>
          데이터 없음
        </div>
      )
    }
    return (
      <Suspense fallback={<Skeleton style={{ width: props.width, height: h }} />}>
        <Impl {...props} />
      </Suspense>
    )
  }
}
