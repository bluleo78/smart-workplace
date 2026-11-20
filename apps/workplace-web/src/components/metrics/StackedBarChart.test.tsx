// StackedBarChart — 껍데기(빈 상태·지연 로딩)와 impl(범례·한도선·막대 클릭) 검증.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { stubChartResize } from '@/test/kits/chartResize'

import { isTopSegment } from './chartData'
import { StackedBarChart } from './StackedBarChart'
import StackedBarChartImpl from './StackedBarChart.impl'

beforeAll(() => stubChartResize())
afterAll(() => vi.unstubAllGlobals())

type Row = { day: string; a: number | null; b: number | null }
const rows: Row[] = [
  { day: '1', a: 1, b: 2 },
  { day: '2', a: 3, b: 1 },
]
const two = [
  { key: 'a', label: '계열A', colorIndex: 1 as const },
  { key: 'b', label: '계열B', colorIndex: 2 as const },
]

describe('StackedBarChart 껍데기', () => {
  it('빈 데이터는 「데이터 없음」', () => {
    render(<StackedBarChart<Row> data={[]} xKey="day" series={two} aria-label="분포" />)
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })

  it('모든 값이 null 이면 「데이터 없음」', () => {
    render(<StackedBarChart<Row> data={[{ day: '1', a: null, b: null }]} xKey="day" series={two} aria-label="분포" />)
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })

  it('데이터가 있으면 스켈레톤 뒤 차트(img)가 뜬다', async () => {
    const { container } = render(
      <StackedBarChart<Row> data={rows} xKey="day" series={two} aria-label="일별 분포" width={400} height={200} />,
    )
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(await screen.findByRole('img', { name: '일별 분포' })).toBeInTheDocument()
  })
})

describe('StackedBarChart impl', () => {
  it('계열 2개면 범례, 1개면 범례 없음', () => {
    const { unmount } = render(
      <StackedBarChartImpl<Row> data={rows} xKey="day" series={two} aria-label="분포" width={400} height={200} />,
    )
    expect(screen.getByText('계열A')).toBeInTheDocument()
    expect(screen.getByText('계열B')).toBeInTheDocument()
    unmount()
    render(<StackedBarChartImpl<Row> data={rows} xKey="day" series={[two[0]]} aria-label="분포" width={400} height={200} />)
    expect(screen.queryByText('계열A')).toBeNull()
  })

  it('limit 라벨이 보인다', () => {
    render(
      <StackedBarChartImpl<Row>
        data={rows}
        xKey="day"
        series={two}
        limit={{ value: 3, label: '한도 3' }}
        aria-label="분포"
        width={400}
        height={200}
      />,
    )
    expect(screen.getByText('한도 3')).toBeInTheDocument()
  })

  it('막대를 누르면 해당 datum 으로 onBarClick 이 불린다', () => {
    const onBarClick = vi.fn()
    const { container } = render(
      <StackedBarChartImpl<Row>
        data={rows}
        xKey="day"
        series={two}
        aria-label="분포"
        width={400}
        height={200}
        onBarClick={onBarClick}
      />,
    )
    const bars = container.querySelectorAll('.recharts-bar-rectangle')
    expect(bars.length).toBeGreaterThan(0)
    fireEvent.click(bars[0].firstElementChild ?? bars[0])
    expect(onBarClick).toHaveBeenCalledWith(rows[0])
  })

  it('한도가 데이터 최댓값보다 커도 limit 라벨이 보인다', () => {
    render(
      <StackedBarChartImpl<Row>
        data={rows}
        xKey="day"
        series={two}
        limit={{ value: 100, label: '큰 한도' }}
        aria-label="추이"
        width={400}
        height={200}
      />,
    )
    expect(screen.getByText('큰 한도')).toBeInTheDocument()
  })
})

describe('isTopSegment', () => {
  const ss = [{ key: 'a' }, { key: 'b' }]
  it('맨 위 계열이 0/null 이면 그 아래 계열이 맨 위 막대다', () => {
    expect(isTopSegment({ a: 3, b: 0 }, ss, 0)).toBe(true)
    expect(isTopSegment({ a: 3, b: null }, ss, 0)).toBe(true)
    expect(isTopSegment({ a: 3, b: 2 }, ss, 0)).toBe(false)
    expect(isTopSegment({ a: 3, b: 2 }, ss, 1)).toBe(true)
    expect(isTopSegment({ a: 0, b: 2 }, ss, 0)).toBe(false)
  })
})

describe('StackedBarChart 접근성·크기', () => {
  it('onBarClick 이 있으면 root 는 group(+aria-label), 없으면 img', async () => {
    const { rerender } = render(
      <StackedBarChartImpl data={[{ day: '1', a: 1 }]} xKey="day" series={[{ key: 'a', label: 'A', colorIndex: 1 }]} aria-label="분포" onBarClick={() => {}} />,
    )
    expect(await screen.findByRole('group', { name: '분포' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '분포' })).toBeNull()
    rerender(<StackedBarChartImpl data={[{ day: '1', a: 1 }]} xKey="day" series={[{ key: 'a', label: 'A', colorIndex: 1 }]} aria-label="분포" />)
    expect(await screen.findByRole('img', { name: '분포' })).toBeInTheDocument()
  })

  it('빈 상태에도 width 가 적용된다', () => {
    render(<StackedBarChart data={[]} xKey="day" series={[{ key: 'a', label: 'A', colorIndex: 1 }]} aria-label="분포" width={300} height={120} />)
    expect(screen.getByText('데이터 없음')).toHaveStyle({ width: '300px', height: '120px' })
  })
})

describe('StackedBarChart 키보드 드릴다운 (WP-1822 후속)', () => {
  function renderClickable(onBarClick: (d: Row) => void) {
    return render(
      <StackedBarChartImpl<Row>
        data={rows}
        xKey="day"
        series={two}
        aria-label="분포"
        width={400}
        height={200}
        onBarClick={onBarClick}
      />,
    )
  }

  it('각 막대 조각이 이름 있는 단추로 초점을 받는다', () => {
    renderClickable(() => {})
    const btns = screen.getAllByRole('button')
    expect(btns.length).toBe(4)
    expect(btns[0]).toHaveAttribute('tabindex', '0')
    expect(btns[0]).toHaveAccessibleName(/계열A/)
  })

  it('Enter·Space 로 onBarClick 이 불린다, 다른 키는 안 불린다', () => {
    const onBarClick = vi.fn()
    renderClickable(onBarClick)
    const btn = screen.getAllByRole('button')[0]
    fireEvent.keyDown(btn, { key: 'Enter' })
    fireEvent.keyDown(btn, { key: ' ' })
    fireEvent.keyDown(btn, { key: 'a' })
    expect(onBarClick).toHaveBeenCalledTimes(2)
    expect(onBarClick).toHaveBeenCalledWith(rows[0])
  })

  it('키보드 초점은 <g> outline 이 아니라 안쪽 막대 path 의 테두리 색(--ring)으로 보인다', () => {
    // SVG <g> 의 outline 은 Safari 등에서 그려지지 않을 수 있어, 초점 표시는 막대 자체의 stroke 로 한다
    renderClickable(() => {})
    const btn = screen.getAllByRole('button')[0]
    expect(btn.getAttribute('class')).toContain('focus-visible:[&>path]:stroke-ring')
    expect(btn.querySelector('path')).not.toBeNull()
  })

  it('onBarClick 이 없으면 단추가 없다', () => {
    render(<StackedBarChartImpl<Row> data={rows} xKey="day" series={two} aria-label="분포" width={400} height={200} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
