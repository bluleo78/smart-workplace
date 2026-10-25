// ComponentChip(WP-933) — 보관된 구성요소는 점선 테두리 + 「(보관됨)」 툴팁·스크린리더 문구로 활성과 구분한다.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ComponentChip, ComponentChips } from './ComponentChip'

describe('ComponentChip', () => {
  it('활성 칩은 실선 테두리에 보관됨 표기가 없다', () => {
    render(<ComponentChip component={{ name: 'Compute', archived: false }} />)
    const chip = screen.getByTitle('Compute')
    expect(chip).not.toHaveClass('border-dashed')
    expect(chip).toHaveClass('text-foreground')
    expect(screen.queryByText('(보관됨)')).not.toBeInTheDocument()
  })

  it('보관된 칩은 점선 + 흐린 글자 + 「(보관됨)」 title·sr-only 문구', () => {
    render(<ComponentChip component={{ name: 'Legacy', archived: true }} />)
    const chip = screen.getByTitle('Legacy (보관됨)')
    expect(chip).toHaveClass('border-dashed', 'text-muted-foreground')
    expect(screen.getByText('(보관됨)')).toHaveClass('sr-only')
  })

  it('칩 묶음 title 도 보관된 이름에 「(보관됨)」 을 붙인다', () => {
    render(
      <ComponentChips
        testId="chips"
        components={[{ id: 1, name: 'A', archived: false }, { id: 2, name: 'Legacy', archived: true }]}
      />,
    )
    expect(screen.getByTestId('chips')).toHaveAttribute('title', 'A, Legacy (보관됨)')
  })
})
