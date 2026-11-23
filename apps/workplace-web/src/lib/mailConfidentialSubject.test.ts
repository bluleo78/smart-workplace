// confidentialDisplaySubject — 받은 기밀 메일 제목에서 「[기밀]」 머리말을 빼는 규칙 표(WP-2030).
import { describe, expect, it } from 'vitest'

import { confidentialDisplaySubject } from './mailConfidentialSubject'

describe('confidentialDisplaySubject', () => {
  it.each<[string, boolean, string]>([
    ['[기밀] 단가', true, '단가'],
    ['Re: [기밀] 단가', true, 'Re: 단가'],
    ['회신: [기밀] 단가', true, '회신: 단가'],
    ['전달: 회신: [기밀] 단가', true, '전달: 회신: 단가'],
    ['RE: FW: [기밀] 단가', true, 'RE: FW: 단가'],
    ['[기밀]단가', true, '단가'],
    ['단가 [기밀]', true, '단가 [기밀]'],
    ['[기밀] 공지', false, '[기밀] 공지'],
  ])('(%s, %s) → %s', (subject, confidential, expected) => {
    expect(confidentialDisplaySubject(subject, confidential)).toBe(expected)
  })
})
