/**
 * 지연 로딩 차트 껍데기 공장 (WP-1822). TrendChart·StackedBarChart 가 같은 껍데기를 쓴다.
 * Recharts 는 impl 로 미뤄 lazy 로 불러 메인·개요 청크에 섞이지 않게 하고,
 * 빈 데이터는 impl 을 부르지 않고 「데이터 없음」으로 끝낸다(불필요한 청크 다운로드 방지).
 * impl 청크 로드가 실패해도(배포 직후 404 등) 라우트 오류 화면까지 올리지 않고 차트 자리에서 「불러오지 못함」으로 끝낸다.
 * 이 파일은 recharts 를 가져오지 않는다 — impl 은 load 콜백 안에서만 동적 import 된다.
 */
import { Component, type ComponentType, lazy, type ReactNode, Suspense, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { ChartEmptyState, ChartErrorState } from './ChartCard'
import { hasAnyValue } from './chartData'
import { type BaseChartProps, DEFAULT_CHART_HEIGHT } from './chartTypes'

/** impl 로드 실패(React.lazy 의 거부)를 잡아 대체 화면을 보이는 경계. 다른 오류와 구분 없이 이 차트 안에서만 처리한다 */
class ChartLoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** load(동적 import)로 impl 을 늦게 불러오는 껍데기 컴포넌트를 만든다. 호출자가 제네릭 시그니처로 한 번 단언해 내보낸다. */
export function makeLazyChart<P extends BaseChartProps<unknown>>(load: () => Promise<{ default: ComponentType<P> }>) {
  // 다음에 처음 그려지는 차트가 쓸 lazy(모듈 공유). 다시 시도가 성공한 lazy 로 바꿔 둬 뒤에 뜨는 차트는 실패를 되풀이하지 않는다
  let shared = lazy(load)
  return function LazyChart(props: P) {
    // 이 차트가 쓰는 lazy — 처음 그릴 때의 공유 값을 붙잡아 둔다. 다른 차트가 다시 시도해도 이 차트는 다시 Suspense 에 걸리지 않는다
    const [Impl, setImpl] = useState(() => shared)
    // 다시 시도한 횟수 — 경계를 새로 세우는 key 이자, 다시 시도도 실패했을 때 새로고침 안내를 보일지 판단에 쓴다
    const [attempt, setAttempt] = useState(0)
    const h = props.height ?? DEFAULT_CHART_HEIGHT
    if (!hasAnyValue(props.data, props.series)) {
      // ChartCard 빈 상태와 같은 문구·모양을 쓰되 고정 크기를 지키고, 보조기기에는 차트 이름과 함께 알린다
      return (
        <ChartEmptyState
          role="img"
          aria-label={`${props['aria-label']}: 데이터 없음`}
          className="flex items-center justify-center py-0"
          style={{ width: props.width, height: h }}
        />
      )
    }
    return (
      <ChartLoadBoundary
        key={attempt}
        fallback={
          <ChartErrorState
            // 배포 직후 404(옛 청크가 사라짐)는 같은 주소를 다시 받아도 실패한다 — 다시 시도도 실패하면 새로고침을 안내한다
            hint={attempt > 0 ? '계속 안 되면 새로고침해 주세요' : undefined}
            onRetry={() => {
              // lazy 는 거부된 약속을 캐시하므로 새로 만든다. 공유 값도 바꿔 뒤에 뜨는 차트가 새 lazy 를 쓰게 한다
              const next = lazy(load)
              shared = next
              setImpl(() => next)
              setAttempt((n) => n + 1)
            }}
          />
        }
      >
        <Suspense fallback={<Skeleton style={{ width: props.width, height: h }} />}>
          <Impl {...props} />
        </Suspense>
      </ChartLoadBoundary>
    )
  }
}
