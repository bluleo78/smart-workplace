// 이슈 레이블 메타 묶음(WP-919) — 최대 칩 수와 넘친 개수 +N, 빈 목록, title 의 전체 이름을 확인한다.
// 데스크톱 이슈 목록·내 작업·개인 목록이 같은 부품을 쓰므로 개수 규칙이 한곳에서 지켜지는지 본다.
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import type { LabelSummary } from '../../types/label'
import { IssueLabelMeta } from './IssueLabelMeta'

/** 이름이 「레이블1」…「레이블N」인 레이블 n 개. */
function labels(n: number): LabelSummary[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `레이블${i + 1}`, colorToken: 'BLUE' }))
}

describe('IssueLabelMeta', () => {
  it('레이블 5개면 칩 2개와 +3', () => {
    renderWithProviders(<IssueLabelMeta labels={labels(5)} testId="meta" />)
    expect(screen.getByText('레이블1')).toBeInTheDocument()
    expect(screen.getByText('레이블2')).toBeInTheDocument()
    expect(screen.queryByText('레이블3')).not.toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('max=1이면 칩 1개와 +4', () => {
    renderWithProviders(<IssueLabelMeta labels={labels(5)} max={1} />)
    expect(screen.getByText('레이블1')).toBeInTheDocument()
    expect(screen.queryByText('레이블2')).not.toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
  })

  it('빈 레이블이면 아무것도 그리지 않는다', () => {
    const { container } = renderWithProviders(<IssueLabelMeta labels={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('title에 전체 이름', () => {
    renderWithProviders(<IssueLabelMeta labels={labels(3)} testId="meta" />)
    expect(screen.getByTestId('meta')).toHaveAttribute('title', '레이블1, 레이블2, 레이블3')
  })
})
