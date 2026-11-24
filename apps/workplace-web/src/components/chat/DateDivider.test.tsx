import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DateDivider } from './DateDivider'

// WP-2046: 날짜로 읽지 못하는 시각이 오면 Intl.format 의 RangeError 로 화면 전체가 깨지지 않고 구분선만 그리지 않는다.
describe('DateDivider', () => {
  it('정상 시각은 KST 날짜로 그린다', () => {
    render(<DateDivider date="2026-06-01T16:00:00Z" />)
    expect(screen.getByTestId('date-divider')).toHaveTextContent('2026년 6월 2일')
  })
  it('읽지 못하는 시각이면 아무것도 그리지 않는다', () => {
    const { container } = render(<DateDivider date={'1795518215.835331' as string} />)
    expect(container).toBeEmptyDOMElement()
  })
})
