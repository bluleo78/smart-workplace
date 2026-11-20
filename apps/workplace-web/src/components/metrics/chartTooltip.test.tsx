// 툴팁 머리글·행 포맷터 단위 검증 (hover 는 jsdom 에서 어려워 함수를 직접 부른다).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { makeTooltipLabelFormatter, makeTooltipRowFormatter } from './chartTooltip'

describe('makeTooltipLabelFormatter', () => {
  const payload = [{ payload: { ts: 1700000000000, day: '월' } }]
  it('xFormatter 없으면 숫자 x 도 문자열로', () => {
    expect(makeTooltipLabelFormatter('ts')(undefined, payload)).toBe('1700000000000')
  })
  it('xFormatter 는 계열 이름이 아닌 원본 x 값을 받는다', () => {
    expect(makeTooltipLabelFormatter('ts', (v) => `t=${v as number}`)('계열A', payload)).toBe('t=1700000000000')
  })
  it('payload 가 비면 빈 문자열', () => {
    expect(makeTooltipLabelFormatter('ts')(undefined, [])).toBe('')
  })
})

describe('makeTooltipRowFormatter', () => {
  it('valueFormatter 없으면 undefined', () => {
    expect(makeTooltipRowFormatter({})).toBeUndefined()
  })
  it('색 칩 + 이름 + 포맷된 값을 그린다', () => {
    const f = makeTooltipRowFormatter({ a: { label: '계열A' } }, (v) => `${v}건`)!
    render(<div>{f(3, 'a', { dataKey: 'a' })}</div>)
    expect(screen.getByTestId('tooltip-swatch').getAttribute('style')).toContain('var(--color-a)')
    expect(screen.getByText('계열A')).toBeInTheDocument()
    expect(screen.getByText('3건')).toBeInTheDocument()
  })
})
