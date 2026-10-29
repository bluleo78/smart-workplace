import { describe, expect, test } from 'vitest'

import { catchupBasisLabel } from './catchupBasis'

describe('catchupBasisLabel (WP-1183)', () => {
  test('상한에 잘리지 않았으면 미읽음 수 그대로', () => {
    expect(catchupBasisLabel({ unreadCount: 6, summarizedCount: 6 })).toBe('근거 6건 기준')
  })
  test('상한에 잘렸으면 최근 몇 건으로 요약했는지 밝힌다', () => {
    expect(catchupBasisLabel({ unreadCount: 210, summarizedCount: 200 })).toBe('근거 최근 200건 기준')
  })
  test('예전 서버(summarizedCount 없음)는 미읽음 수 그대로', () => {
    expect(catchupBasisLabel({ unreadCount: 6 })).toBe('근거 6건 기준')
  })
})
