// 필터 팝오버(role=dialog)의 접근 가능한 이름(WP-2067) — 칩·「더 보기」·「＋ 필터」가 열면 스크린리더가 「dialog」가 아니라 무엇인지 읽는다.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { AddFilterButton } from './AddFilterButton'
import { FilterChip } from './FilterChip'
import { QuickFilterBar } from './QuickFilterBar'
import type { FacetDef } from './types'

const facets: FacetDef[] = [
  {
    key: 'status',
    label: '상태',
    options: [
      { value: 'open', label: '열림' },
      { value: 'done', label: '완료' },
    ],
  },
  { key: 'priority', label: '우선순위', options: [{ value: 'high', label: '높음' }] },
]

describe('필터 팝오버 이름', () => {
  it('빠른 필터 칩 팝오버는 「{facet} 선택」', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <QuickFilterBar facets={facets} value={{}} onChange={vi.fn()} defaultChips={['status']} storageKey="t" />,
    )
    await user.click(screen.getByTestId('quick-filter-status-trigger'))
    expect(await screen.findByRole('dialog', { name: '상태 선택' })).toBeInTheDocument()
  })

  it('「더 보기」 팝오버는 「필터 항목 선택」', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <QuickFilterBar facets={facets} value={{}} onChange={vi.fn()} defaultChips={['status']} storageKey="t" />,
    )
    await user.click(screen.getByTestId('quick-filter-more'))
    expect(await screen.findByRole('dialog', { name: '필터 항목 선택' })).toBeInTheDocument()
  })

  it('값이 걸린 칩(FilterChip) 팝오버는 「{facet} 선택」', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FilterChip facet={facets[0]} selected={['open']} onToggle={vi.fn()} onClear={vi.fn()} />)
    await user.click(screen.getByText('상태:'))
    expect(await screen.findByRole('dialog', { name: '상태 선택' })).toBeInTheDocument()
  })

  it('「＋ 필터」 팝오버는 「필터 항목 선택」', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AddFilterButton facets={facets} value={{}} onToggle={vi.fn()} />)
    await user.click(screen.getByTestId('add-filter-trigger'))
    expect(await screen.findByRole('dialog', { name: '필터 항목 선택' })).toBeInTheDocument()
  })
})
