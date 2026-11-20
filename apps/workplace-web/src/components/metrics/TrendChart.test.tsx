// TrendChart — 껍데기(빈 상태·지연 로딩)와 impl(범례·한도선) 검증.
import { render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { stubChartResize } from '@/test/kits/chartResize'

import { TrendChart } from './TrendChart'
import TrendChartImpl from './TrendChart.impl'

beforeAll(() => stubChartResize())
afterAll(() => vi.unstubAllGlobals())

type Row = { day: string; a: number | null; b: number | null }
const rows: Row[] = [
  { day: '1', a: 1, b: 2 },
  { day: '2', a: 3, b: 1 },
  { day: '3', a: 2, b: 4 },
]
const two = [
  { key: 'a', label: '계열A', colorIndex: 1 as const },
  { key: 'b', label: '계열B', colorIndex: 2 as const },
]

describe('TrendChart 껍데기', () => {
  it('빈 데이터는 「데이터 없음」', () => {
    render(<TrendChart<Row> data={[]} xKey="day" series={two} aria-label="추이" />)
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })

  it('모든 값이 null 이면 「데이터 없음」', () => {
    const nulls: Row[] = [{ day: '1', a: null, b: null }]
    render(<TrendChart<Row> data={nulls} xKey="day" series={two} aria-label="추이" />)
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })

  it('데이터가 있으면 스켈레톤 뒤 차트(img)가 뜬다', async () => {
    const { container } = render(
      <TrendChart<Row> data={rows} xKey="day" series={two} aria-label="일별 추이" width={400} height={200} />,
    )
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(await screen.findByRole('img', { name: '일별 추이' })).toBeInTheDocument()
  })
})

describe('TrendChart impl', () => {
  it('계열 2개면 범례 글자가 모두 보인다', () => {
    render(<TrendChartImpl<Row> data={rows} xKey="day" series={two} aria-label="추이" width={400} height={200} />)
    expect(screen.getByText('계열A')).toBeInTheDocument()
    expect(screen.getByText('계열B')).toBeInTheDocument()
  })

  it('계열 1개면 범례가 없다', () => {
    render(<TrendChartImpl<Row> data={rows} xKey="day" series={[two[0]]} aria-label="추이" width={400} height={200} />)
    expect(screen.queryByText('계열A')).toBeNull()
  })

  it('limit 라벨이 보인다', () => {
    render(
      <TrendChartImpl<Row>
        data={rows}
        xKey="day"
        series={two}
        limit={{ value: 3, label: '한도 3' }}
        aria-label="추이"
        width={400}
        height={200}
      />,
    )
    expect(screen.getByText('한도 3')).toBeInTheDocument()
  })

  it('한도가 데이터 최댓값보다 커도 limit 라벨이 보인다', () => {
    render(
      <TrendChartImpl<Row>
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

describe('TrendChart 빈 상태 크기', () => {
  it('빈 상태에도 width 가 적용된다', () => {
    render(<TrendChart<Row> data={[]} xKey="day" series={two} aria-label="추이" width={300} height={120} />)
    expect(screen.getByText('데이터 없음')).toHaveStyle({ width: '300px', height: '120px' })
  })
})

describe('TrendChart 고립된 점 (WP-1822 후속)', () => {
  it('양옆이 null 인 점과 한 점짜리 계열은 점으로 그린다, 이어진 선 위 점은 안 그린다', () => {
    const data = [
      { day: '1', a: 1, b: 5 },
      { day: '2', a: 2, b: null },
      { day: '3', a: null, b: 4 },
      { day: '4', a: 3, b: null },
      { day: '5', a: 2, b: null },
    ]
    const { container } = render(
      <TrendChartImpl data={data} xKey="day" series={two} aria-label="추이" width={400} height={200} />,
    )
    // a: 1·2 이어짐(점 없음), 4·5 이어짐 / b: 1 은 고립, 3 도 고립 → 2개
    expect(container.querySelectorAll('[data-testid="isolated-dot"]').length).toBe(2)
  })

  it('계열 값이 한 점뿐이면 점이 그려진다', () => {
    const data = [{ day: '1', a: 1, b: null }]
    const { container } = render(
      <TrendChartImpl data={data} xKey="day" series={[two[0]]} aria-label="추이" width={400} height={200} />,
    )
    expect(container.querySelectorAll('[data-testid="isolated-dot"]').length).toBe(1)
  })
})

describe('TrendChart 계열 키 색 (WP-1822 후속)', () => {
  it('점이 든 키도 색 변수가 안전한 이름으로 정의되고 선이 그 변수를 쓴다', () => {
    const data = [
      { day: '1', 'ai.tokens': 1 },
      { day: '2', 'ai.tokens': 3 },
    ]
    const { container } = render(
      <TrendChartImpl
        data={data}
        xKey="day"
        series={[{ key: 'ai.tokens', label: 'AI', colorIndex: 1 }]}
        aria-label="추이"
        width={400}
        height={200}
      />,
    )
    expect(container.querySelector('style')?.textContent).toContain('--color-ai_tokens: var(--chart-1)')
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke')).toBe('var(--color-ai_tokens)')
  })
})
