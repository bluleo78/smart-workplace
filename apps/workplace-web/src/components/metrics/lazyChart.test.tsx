// lazyChart — chunk 로드 실패를 차트 안에서 잡고, 빈 상태 문구·접근성 이름을 ChartCard 와 한 벌로 쓰는지 검증.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChartCard } from './ChartCard'
import type { BaseChartProps } from './chartTypes'
import { makeLazyChart } from './lazyChart'

const series = [{ key: 'a', label: 'A', colorIndex: 1 as const }]
const data = [{ day: '1', a: 1 }]
type Props = BaseChartProps<unknown>
/** 실제 TrendChart 처럼 제네릭 시그니처로 단언 — xKey 를 데이터 타입에 맞춰 쓴다 */
type Row = { day: string; a: number }
type ChartFn = (props: BaseChartProps<Row>) => ReactElement

afterEach(() => vi.restoreAllMocks())

describe('makeLazyChart', () => {
  it('impl 로드가 실패해도 던지지 않고 「불러오지 못함」+「다시 시도」를 보이며, 재시도하면 그린다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let attempt = 0
    const Chart = makeLazyChart<Props>(() => {
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('Failed to fetch dynamically imported module'))
        : Promise.resolve({ default: () => <div>차트 본문</div> })
    }) as unknown as ChartFn
    render(<Chart data={data} xKey="day" series={series} aria-label="추이" />)
    expect(await screen.findByText('불러오지 못함')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('차트 본문')).toBeInTheDocument()
  })

  it('한 차트의 다시 시도가 같은 화면의 멀쩡한 차트를 다시 로딩(Suspense)으로 돌리지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let call = 0
    const Chart = makeLazyChart<Props>(() => {
      call += 1
      if (call === 1) return Promise.reject(new Error('404'))
      if (call === 2) return Promise.resolve({ default: () => <div>차트 본문</div> })
      // 세 번째 로드는 끝나지 않는다 — 이 lazy 를 만나는 차트는 스켈레톤에 머문다
      return new Promise(() => {})
    }) as unknown as ChartFn
    // 같은 요소 객체를 다시 넘기면 React 가 다시 그리지 않으므로 매번 새로 만든다
    const tree = () => (
      <>
        <Chart data={[...data]} xKey="day" series={series} aria-label="가" />
        <Chart data={[...data]} xKey="day" series={series} aria-label="나" />
      </>
    )
    const { rerender } = render(tree())
    expect(await screen.findAllByText('불러오지 못함')).toHaveLength(2)
    // 첫 차트만 다시 시도 → 성공
    await userEvent.click(screen.getAllByRole('button', { name: '다시 시도' })[0])
    expect(await screen.findByText('차트 본문')).toBeInTheDocument()
    // 둘째 차트 다시 시도 → 끝나지 않는 로드. 다시 그려도 첫 차트는 본문을 유지해야 한다
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    rerender(tree())
    // 다시 Suspense 에 걸리면 React 는 본문을 지우지 않고 display:none 으로 숨기므로 보이는지로 본다
    expect(screen.getByText('차트 본문')).toBeVisible()
  })

  it('다시 시도도 실패하면 새로고침 안내를 함께 보인다(배포 직후 404 는 새로고침으로만 회복)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Chart = makeLazyChart<Props>(() => Promise.reject(new Error('404'))) as unknown as ChartFn
    render(<Chart data={data} xKey="day" series={series} aria-label="추이" />)
    expect(await screen.findByText('불러오지 못함')).toBeInTheDocument()
    expect(screen.queryByText(/새로고침/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText(/새로고침/)).toBeInTheDocument()
  })

  it('빈 데이터는 aria-label 을 달고, ChartCard 빈 상태와 같은 문구 한 벌을 쓴다', () => {
    const Chart = makeLazyChart<Props>(() => Promise.resolve({ default: () => null })) as unknown as ChartFn 
    const { unmount } = render(<Chart data={[]} xKey="day" series={series} aria-label="추이" />)
    expect(screen.getByRole('img', { name: '추이: 데이터 없음' })).toHaveTextContent('데이터 없음')
    unmount()
    render(<ChartCard title="t" state="empty" />)
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })
})
