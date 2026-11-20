// StatCard — 제목·값·meta, href 가 있을 때 링크.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { StatCard } from './StatCard'

describe('StatCard', () => {
  it('제목·값·meta 를 그린다', () => {
    render(<StatCard testId="s" title="완료" value={12} meta="그 전 7일 3건" />)
    expect(screen.getByText('완료')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('그 전 7일 3건')).toBeInTheDocument()
    expect(screen.queryByTestId('s-link')).toBeNull()
  })

  it('href 가 있으면 링크다', () => {
    render(
      <MemoryRouter>
        <StatCard testId="s" title="완료" value={1} meta="" href="/x" />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('s-link')).toHaveAttribute('href', '/x')
  })
})
