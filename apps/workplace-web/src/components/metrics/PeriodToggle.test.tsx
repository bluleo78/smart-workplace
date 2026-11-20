// PeriodToggle — 묶음 이름, 선택 표시, 클릭.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PeriodToggle } from './PeriodToggle'

const OPTIONS = [
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
]

describe('PeriodToggle', () => {
  it('선택된 단추만 aria-pressed 다', () => {
    render(<PeriodToggle options={OPTIONS} value="7d" onChange={() => {}} aria-label="기간" />)
    expect(screen.getByRole('group', { name: '기간' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7일' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '30일' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('누르면 onChange(value)', async () => {
    const onChange = vi.fn()
    render(<PeriodToggle options={OPTIONS} value="7d" onChange={onChange} aria-label="기간" />)
    await userEvent.click(screen.getByRole('button', { name: '30일' }))
    expect(onChange).toHaveBeenCalledWith('30d')
  })
})
