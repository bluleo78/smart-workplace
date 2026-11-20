// ChartCard — 세 상태와 본문.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChartCard } from './ChartCard'

describe('ChartCard', () => {
  it('상태가 없으면 children', () => {
    render(
      <ChartCard title="추이" unit="건">
        <div>본문</div>
      </ChartCard>,
    )
    expect(screen.getByText('추이')).toBeInTheDocument()
    expect(screen.getByText('건')).toBeInTheDocument()
    expect(screen.getByText('본문')).toBeInTheDocument()
  })

  it('loading 은 스켈레톤', () => {
    render(
      <ChartCard title="추이" state="loading">
        <div>본문</div>
      </ChartCard>,
    )
    expect(screen.getByTestId('chart-card-loading')).toBeInTheDocument()
    expect(screen.queryByText('본문')).toBeNull()
  })

  it('empty 는 「데이터 없음」', () => {
    render(<ChartCard title="추이" state="empty" />)
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })

  it('error 는 「불러오지 못함」과 다시 시도', async () => {
    const onRetry = vi.fn()
    render(<ChartCard title="추이" state="error" onRetry={onRetry} />)
    expect(screen.getByText('불러오지 못함')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
