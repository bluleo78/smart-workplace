import { describe, it, expect } from 'vitest'
import { parseIssueSummaryJson } from './run-issue-summary.js'

describe('parseIssueSummaryJson', () => {
  it('코드펜스 감싼 JSON 을 파싱한다', () => {
    const out = parseIssueSummaryJson('```json\n{"summary":"리뷰 대기","nextAction":"리뷰어 지정"}\n```')
    expect(out).toEqual({ summary: '리뷰 대기', nextAction: '리뷰어 지정' })
  })
  it('JSON 없으면 빈 문자열로 폴백한다', () => {
    expect(parseIssueSummaryJson('헛소리')).toEqual({ summary: '', nextAction: '' })
  })
  it('nextAction 누락 시 빈 문자열', () => {
    expect(parseIssueSummaryJson('{"summary":"x"}')).toEqual({ summary: 'x', nextAction: '' })
  })
})
