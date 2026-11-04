// 목록 필터 칸 FilterInput(WP-1352) — 검색(SearchInput, 돋보기)과 모양·말로 구분되는지, controlled 입력·지우기·길이 상한이
// SearchInput 과 같은 규칙으로 동작하는지 본다. SearchInput 은 같은 내부 구현을 쓰므로 기존 동작(「검색어 지우기」)이 그대로인지도 함께 본다.
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SEARCH_QUERY_MAX_LENGTH } from '@/lib/searchLimits'

import { FilterInput } from './filter-input'
import { SearchInput } from './search-input'

/** 실제 호출부처럼 상태를 들고 FilterInput 을 띄운다 — 지우기 버튼 노출이 값에 따라 바뀌는지 보려면 controlled 여야 한다. */
function StatefulFilter({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <FilterInput
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
      inputTestId="filter"
    />
  )
}

describe('FilterInput', () => {
  it('깔때기 아이콘을 보이고 돋보기는 쓰지 않는다', () => {
    const { container } = render(<FilterInput value="" onChange={() => {}} />)
    const funnel = container.querySelector('svg.lucide-funnel')
    expect(funnel).not.toBeNull()
    // 장식 아이콘 — 스크린리더가 읽지 않는다
    expect(funnel).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('svg.lucide-search')).toBeNull()
  })

  it('자리표시를 주지 않으면 「필터」가 자리표시이자 접근 가능 이름이다', () => {
    render(<FilterInput value="" onChange={() => {}} />)
    const input = screen.getByRole('textbox', { name: '필터' })
    expect(input).toHaveAttribute('placeholder', '필터')
  })

  it('aria-label 을 주면 자리표시 대신 그것이 이름이 된다', () => {
    render(<FilterInput value="" onChange={() => {}} placeholder="이름·이메일" aria-label="구성원 필터" />)
    const input = screen.getByRole('textbox', { name: '구성원 필터' })
    expect(input).toHaveAttribute('placeholder', '이름·이메일')
  })

  it('입력하면 onChange 로 문자열을 그대로 넘긴다(공백·한글 포함)', () => {
    const onChange = vi.fn()
    render(<FilterInput value="" onChange={onChange} inputTestId="filter" />)
    const input = screen.getByTestId('filter')
    fireEvent.change(input, { target: { value: '  재경 ' } })
    expect(onChange).toHaveBeenLastCalledWith('  재경 ')
    fireEvent.change(input, { target: { value: '   ' } })
    expect(onChange).toHaveBeenLastCalledWith('   ')
  })

  it('값이 있을 때만 「필터 지우기」가 보이고 누르면 빈 문자열로 비운다', () => {
    const onChange = vi.fn()
    render(<StatefulFilter onChange={onChange} />)
    expect(screen.queryByRole('button', { name: '필터 지우기' })).toBeNull()

    fireEvent.change(screen.getByTestId('filter'), { target: { value: '김' } })
    fireEvent.click(screen.getByRole('button', { name: '필터 지우기' }))
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(screen.getByTestId('filter')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '필터 지우기' })).toBeNull()
  })

  it('검색어와 같은 길이 상한을 둔다', () => {
    render(<FilterInput value="" onChange={() => {}} inputTestId="filter" />)
    expect(screen.getByTestId('filter')).toHaveAttribute('maxLength', String(SEARCH_QUERY_MAX_LENGTH))
  })

  it('className 을 바깥 틀에 더한다 — 폭은 호출부가 정한다', () => {
    const { container } = render(<FilterInput value="" onChange={() => {}} className="max-w-none w-full" />)
    expect(container.firstElementChild).toHaveClass('relative', 'w-full', 'max-w-none')
  })
})

describe('SearchInput(같은 내부 구현) — 기존 동작 유지', () => {
  it('돋보기 아이콘과 기본 자리표시 「검색...」을 쓰고 깔때기는 없다', () => {
    const { container } = render(<SearchInput value="" onChange={() => {}} />)
    expect(container.querySelector('svg.lucide-search')).not.toBeNull()
    expect(container.querySelector('svg.lucide-funnel')).toBeNull()
    expect(screen.getByRole('textbox', { name: '검색...' })).toHaveAttribute('maxLength', String(SEARCH_QUERY_MAX_LENGTH))
  })

  it('값이 있을 때만 「검색어 지우기」가 보이고 누르면 빈 문자열을 넘긴다', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SearchInput value="" onChange={onChange} />)
    expect(screen.queryByRole('button', { name: '검색어 지우기' })).toBeNull()
    rerender(<SearchInput value="abc" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '검색어 지우기' }))
    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.queryByRole('button', { name: '필터 지우기' })).toBeNull()
  })
})
