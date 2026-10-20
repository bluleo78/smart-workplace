import { describe, expect, it } from 'vitest'

import { firstSummaryLine } from './mailSummary'

describe('firstSummaryLine', () => {
  it('빈 줄을 건너뛴 첫 불릿에서 기호를 뗀다', () => {
    expect(firstSummaryLine('\n• 나에게: 금요일까지 회신\n• 핵심: 일정 연기')).toBe('나에게: 금요일까지 회신')
  })

  it('불릿이 없으면 첫 줄 그대로', () => {
    expect(firstSummaryLine('한 줄 요약')).toBe('한 줄 요약')
  })

  it('글자가 없으면 null — 불릿 기호만 있는 줄은 건너뛴다', () => {
    expect(firstSummaryLine('')).toBeNull()
    expect(firstSummaryLine(' \n•  \n')).toBeNull()
    expect(firstSummaryLine('•\n• 핵심: 내용')).toBe('핵심: 내용')
  })
})
