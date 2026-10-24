// formatListDueDate(WP-919) — 목록 마감 칸 공용 표기 단위 테스트.
// 올해(브라우저 로컬)면 「M월 D일」, 다른 해면 「YYYY. M. D」, 없음·무효면 EMPTY_GLYPH(—).
import { describe, expect, it } from 'vitest'

import { EMPTY_GLYPH, formatListDueDate } from './formatters'

describe('formatListDueDate', () => {
  const now = new Date(2026, 9, 24)
  it('올해는 월·일', () => expect(formatListDueDate('2026-10-25', now)).toBe('10월 25일'))
  it('다른 해는 점 표기', () => expect(formatListDueDate('2027-01-05', now)).toBe('2027. 1. 5'))
  it('지난 해도 점 표기', () => expect(formatListDueDate('2025-12-31', now)).toBe('2025. 12. 31'))
  it('없음·무효는 —', () => {
    expect(formatListDueDate(null, now)).toBe('—')
    expect(formatListDueDate('2026-13-01x', now)).toBe('—')
  })
  it('형식·범위가 틀린 값도 EMPTY_GLYPH', () => {
    for (const v of [undefined, '', '2026-06', 'abc-de-fg', '2026-00-10', '2026-13-01', '2026-02-30']) {
      expect(formatListDueDate(v, now)).toBe(EMPTY_GLYPH)
    }
  })
})
