// 「AI 현황 › 개요」 차트 준비 자리(WP-1824 · WP-2079) — 데이터가 오기 전 골격 단계에서 감춘 차트를 한 번 그려
// Recharts 첫 실행 비용(V8 최초 실행 컴파일·티어업)을 데이터보다 먼저 치른다. 이 비용은 첫 차트가 혼자 떠안으면
// ~200ms 긴 태스크가 되지만(데이터 도착 직후), 먼저 실행해 둔 뒤에는 같은 자리가 4~5배 짧다.
// 두 칸의 자리가 모두 내려앉으면(그림, 또는 오류 화면) onWarmed 로 알린다 — 페이지는 이 신호로 차트 단계를 열어,
// 청크가 응답보다 늦어도 준비가 데이터 뒤로 밀리지 않게 한다(WP-2079 3라운드).
// 껍데기(lazy)를 그대로 쓰므로 `.impl` 정적 import 는 없다 — 로드는 각 껍데기의 안쪽 Suspense 가 맡으므로 바깥 Suspense 는
// 걸리는 일이 없어 두지 않는다. 차트 오류는 두 갈래로 오는데(껍데기 안쪽 경계가 잡아 오류 화면으로 내려앉히거나, 껍데기 밖으로
// 새거나) 어느 쪽이든 「준비는 끝났다」로 쳐 완료 신호를 보낸다(4라운드) — 오류로 자리가 멈추면 차트 단계가 영영 안 열린다.
// 자리는 화면 밖 고정 위치 + aria-hidden 이라 문구·레이아웃·testid 에 영향이 없고, 준비가 끝나거나 청크가 실패하면
// 페이지가 저절로 없앤다.
import { Component, type ReactNode, useCallback, useEffect, useRef } from 'react'

import type { ChartSeries } from '@/components/metrics/chartTypes'
import { StackedBarChart } from '@/components/metrics/StackedBarChart'
import { TrendChart } from '@/components/metrics/TrendChart'
import { formatNumber } from '@/lib/formatters'

import type { ChartRow } from './aiStatusModel'
import { X_KEY } from './aiStatusModel'

/**
 * 준비 자리에 넣을 가짜 행 — 실제 응답과 같은 모양(구간 6개·계열 2개)으로 선·막대·범례 코드 경로를 같이 탄다.
 * 값은 언제나 number(0 포함)라 hasAnyValue 를 통과한다 — 빈 상태로 내려앉으면 그림(svg)이 영영 없어
 * 준비 신호가 안 와 게이트가 닫힌 채 남는다. 이 전제를 깨는 값으로 바꾸지 말 것.
 */
const WARMUP_ROWS: ChartRow[] = Array.from({ length: 6 }, (_, i) => ({
  [X_KEY]: `2026-11-25T0${i}:00:00Z`,
  first: i * 2,
  second: (i * 3) % 7,
}))

/** 두 계열 — 계열 2개여야 범례·다중 선(막대) 경로까지 덮는다(사실과 다른 값이어도 화면에 보이지 않는다). */
const WARMUP_SERIES: ChartSeries[] = [
  { key: 'first', label: '첫째', colorIndex: 1 },
  { key: 'second', label: '둘째', colorIndex: 2 },
]

export type AiStatusChartWarmupProps = {
  /** 두 칸의 자리가 모두 내려앉았을 때(그림, 또는 오류 화면) — 페이지가 차트 단계를 열 준비가 됐음을 안다 */
  onWarmed?: () => void
}

/**
 * 준비 자리 안쪽 오류 경계 — 차트가 그려지다 오류로 터지면 그림 신호(svg)는 영영 오지 않는다.
 * 오류도 「준비는 끝났다」로 쳐 같은 완료 신호(onWarmed)를 보낸다: 자리가 오류로 멈추면 warmed 가 안 와
 * 차트 단계 2~4 가 영영 안 열리고(데드락), 오류도 화면 밖에 묻혀 안 나온다.
 * 껍데기 안쪽 경계가 잡은 오류는 자리 관찰자가 오류 화면을 보고 같은 신호를 보내고(아래 bothSettled),
 * 그 밖에서 새는 오류는 이 경계가 보낸다 — 두 길 모두 신호는 한 번만 간다.
 */
class WarmupChartBoundary extends Component<{ onErrorSignal: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    // 완료 신호 채널을 그대로 쓴다 — 페이지는 「준비 끝」으로만 읽으므로 오류·성공이 갈리지 않는다
    this.props.onErrorSignal()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * 차트 준비 자리 — 골격과 함께 그려지는 감춘 컨테이너. 안의 두 차트는 각자 자기 자리(고정 크기)에서 그려
 * 실제 차트와 같은 측정·렌더 경로를 밟는다. impl 청크가 아직이면 각 차트의 안쪽 Suspense 자리에서 기다렸다가
 * 청크가 도착하면 그 자리에서 그려진다(페이지 chartsReady 선로딩이 그 시점을 당긴다).
 *
 * 출력 감지는 자리를 다시 그리는 재렌더에 기대지 않는다 — 그림은 lazy 껍데기 안에서 그려져 여기의 렌더와 경로가
 * 겹치지 않으므로, 자리 안 DOM 을 MutationObserver 로 지켜 두 칸이 그림(첫 실행 비용 선결)이나 오류 화면
 * (더 기다려도 나아질 일 없음) 중 하나로 내려앉은 순간에 한 번만 신호를 보낸다.
 */
export function AiStatusChartWarmup({ onWarmed }: AiStatusChartWarmupProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const signaledRef = useRef(false)

  // 신호는 한 번만 — 자리 관찰자와 오류 경계가 같은 길을 쓰므로 두 곳이 같은 신호를 두 번 보내지 않는다.
  // 그리기 여부를 보지 않는 길이라 오류 경계가 부를 수 있다(오류 화면엔 그림이 없으니까).
  const signal = useCallback(() => {
    if (signaledRef.current) return
    signaledRef.current = true
    onWarmed?.()
  }, [onWarmed])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    // 자리가 그림(svg)으로 내려앉았거나 오류 화면(다시 시도 단추)으로 내려앉았으면 더 기다릴 일이 없다 —
    // 오류 화면엔 그림이 없어 그대로 두면 신호가 영영 안 오는데(4라운드), 그 자리는 그릴 만큼 그린 것으로 친다
    const slotSettled = (slot: HTMLDivElement | null) =>
      !!slot?.querySelector('svg') || !!slot?.querySelector('button')
    // 두 칸이 모두 내려앉아야 첫 실행 비용이 선결된다 — 한쪽만으로는 반쪽만 치른다
    const bothSettled = () => slotSettled(lineRef.current) && slotSettled(barRef.current)
    const notify = () => {
      if (signaledRef.current || !bothSettled()) return
      signal()
    }
    const observer = new MutationObserver(notify)
    observer.observe(root, { childList: true, subtree: true })
    notify() // 청크가 먼저 도착해 마운트와 함께 그려지는 경우를 위한 최초 확인
    return () => observer.disconnect()
  }, [signal])

  return (
    <div
      data-testid="ai-status-chart-warmup"
      aria-hidden="true"
      // 화면 밖이라 실사는 안 닿지만, 체크 실패 경로의 「다시 시도」 단추가 포커스 대상으로 남지 않게 잠근다
      inert
      ref={rootRef}
      style={{ position: 'fixed', insetInlineStart: -10000, top: 0, width: 360, height: 400, overflow: 'hidden' }}
    >
      <WarmupChartBoundary onErrorSignal={signal}>
        <div ref={lineRef} style={{ width: 360, height: 200 }}>
          <TrendChart
            data={WARMUP_ROWS}
            xKey={X_KEY}
            series={WARMUP_SERIES}
            valueFormatter={formatNumber}
            aria-label="차트 준비(선)"
          />
        </div>
        <div ref={barRef} style={{ width: 360, height: 200 }}>
          <StackedBarChart
            data={WARMUP_ROWS}
            xKey={X_KEY}
            series={WARMUP_SERIES}
            valueFormatter={formatNumber}
            aria-label="차트 준비(막대)"
          />
        </div>
      </WarmupChartBoundary>
    </div>
  )
}
