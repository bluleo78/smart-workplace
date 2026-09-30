// 배지 표기 규칙 고정 — 탭바·벨 공용.
import { describe, expect, it } from 'vitest'

import { formatBadgeCount } from './badge'

describe('formatBadgeCount', () => {
  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [1234, '99+'],
  ])('%i → %s', (n, s) => expect(formatBadgeCount(n)).toBe(s))
})
