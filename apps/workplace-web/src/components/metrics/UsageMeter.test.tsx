// UsageMeter — aria 값, tone, 너비 자르기.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UsageMeter } from './UsageMeter'

describe('UsageMeter', () => {
  it('aria 값과 tone 을 단다', () => {
    render(<UsageMeter percent={42.6} tone="warning" label="5시간 사용률" />)
    const bar = screen.getByRole('progressbar', { name: '5시간 사용률' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('data-tone', 'warning')
  })

  it('120 은 100% 로 자른다', () => {
    render(<UsageMeter percent={120} tone="destructive" label="사용률" />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect((bar.firstChild as HTMLElement).style.width).toBe('100%')
  })
})
