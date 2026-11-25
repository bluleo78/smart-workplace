// 차트 준비 자리(WP-2079 3라운드) — 자리 컨테이너만 있는 것이 아니라 두 차트(선·막대)의 출력이 실제로 그려져야
// Recharts 첫 실행 비용을 미리 치르고, 그려진 뒤에만 준비 완료(onWarmed) 신호가 간다. 페이지는 이 신호로 차트 단계를 연다.
// 4라운드 하딩 — 차트가 오류로 내려앉아도 신호는 나가야 한다: 오류로 자리가 멈추면 차트 단계 2~4 가 영영 안 열린다.
import { render, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'

import type { BaseChartProps } from '@/components/metrics/chartTypes'
import { stubChartResize } from '@/test/kits/chartResize'

import { AiStatusChartWarmup } from './AiStatusChartWarmup'

/** 차트 축·막대는 jsdom 에서 리사이즈를 받아야 그려진다 — 이 파일의 차트 출력 단언에 적용. */
beforeAll(() => stubChartResize())
afterAll(() => vi.unstubAllGlobals())

/** 차트를 오류로 터트리는 스위치 — 모듈은 한 번만 불리지만 이 값은 렌더 때마다 읽으므로 테스트마다 바꿔 끼운다 */
const faultSwitch = vi.hoisted(() => ({
  /** 껍데기(로드 전 자리) 렌더가 오류로 터진다 — 이 오류가 준비 자리 밖으로 새는 경우 */
  shellError: false,
  /** 구현(.impl) 렌더가 오류로 터진다 — 실제 껍데기의 안쪽 경계가 잡아 오류 화면(그림 없음)으로 내려앉힌다 */
  implError: false,
}))

/** 껍데기 오류 스위치 — 안쪽 경계가 끼어들기 전에 터뜨리는 위치(껍데기 자체 렌더) */
vi.mock('@/components/metrics/TrendChart', async () => {
  const actual = await vi.importActual<typeof import('@/components/metrics/TrendChart')>('@/components/metrics/TrendChart')
  return {
    ...actual,
    TrendChart: (props: BaseChartProps<unknown>) => {
      if (faultSwitch.shellError) throw new Error('차트 껍데기 오류')
      return <actual.TrendChart {...props} />
    },
  }
})

/** 구현 오류 스위치 — 실제 껍데기의 ChartLoadBoundary 가 잡아 오류 화면으로 내려앉히는 경로를 그대로 쓰기 위함 */
vi.mock('@/components/metrics/TrendChart.impl', async () => {
  const actual = await vi.importActual<typeof import('@/components/metrics/TrendChart.impl')>(
    '@/components/metrics/TrendChart.impl',
  )
  return {
    ...actual,
    default: (props: BaseChartProps<unknown>) => {
      if (faultSwitch.implError) throw new Error('차트 구현 오류')
      return <actual.default {...props} />
    },
  }
})

/** 리액트가 경계에 잡은 오류를 콘솔에 찍는 소리 — 오류가 의도된 두 테스트에서만 끈다 */
let consoleError: { mockRestore: () => void } | undefined
afterEach(() => {
  consoleError?.mockRestore()
  consoleError = undefined
  faultSwitch.shellError = false
  faultSwitch.implError = false
})

test('두 차트의 출력이 실제로 자리 안에 그려진 뒤 준비 완료 신호를 한 번만 보낸다', async () => {
  const onWarmed = vi.fn()
  const { container, rerender } = render(<AiStatusChartWarmup onWarmed={onWarmed} />)
  const warmupSlot = within(container).getByTestId('ai-status-chart-warmup')
  // 자리만 잡고 있는(스켈레톤) 상태로는 신호가 가지 않는다 — 첫 실행 비용을 치른 것은 그림이 실제로 나왔을 때다
  await waitFor(() => expect(warmupSlot.querySelectorAll('svg').length).toBeGreaterThan(0))
  // 두 칸(선·막대)이 모두 그려져야 비용이 선결된다 — 한쪽만으로는 반쪽만 치른다
  await waitFor(() => expect(within(warmupSlot).getAllByRole('img', { hidden: true })).toHaveLength(2))
  await waitFor(() => expect(onWarmed).toHaveBeenCalledTimes(1))
  // 다시 그려져도 신호는 중복으로 가지 않는다 — 페이지 단계가 되풀이 흔들리지 않게
  rerender(<AiStatusChartWarmup onWarmed={onWarmed} />)
  expect(onWarmed).toHaveBeenCalledTimes(1)
})

test('껍데기 렌더가 오류로 터져도 준비 완료 신호를 한 번만 보낸다(WP-2079 4라운드)', async () => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  faultSwitch.shellError = true
  const onWarmed = vi.fn()
  render(<AiStatusChartWarmup onWarmed={onWarmed} />)
  // 오류가 자리 밖으로 새어도 신호는 나가야 한다 — 화면 밖에서 멈추면 차트 단계가 영영 안 열린다
  await waitFor(() => expect(onWarmed).toHaveBeenCalledTimes(1))
})

test('구현(.impl)이 오류로 터져 오류 화면으로 내려앉아도 준비 완료 신호를 보낸다(WP-2079 4라운드)', async () => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  faultSwitch.implError = true
  const onWarmed = vi.fn()
  const { container } = render(<AiStatusChartWarmup onWarmed={onWarmed} />)
  const warmupSlot = within(container).getByTestId('ai-status-chart-warmup')
  // 안쪽 경계가 오류를 잡아 오류 화면(다시 시도 단추, 그림 svg 없음)으로 내려앉힌다 — 여기서 신호가 멈추면
  // warmed 가 안 와 차트 단계 2~4 가 영영 안 열리고 오류도 화면에 안 나온다
  await waitFor(() => expect(within(warmupSlot).getByRole('button', { hidden: true })).toBeInTheDocument())
  await waitFor(() => expect(onWarmed).toHaveBeenCalledTimes(1))
})
