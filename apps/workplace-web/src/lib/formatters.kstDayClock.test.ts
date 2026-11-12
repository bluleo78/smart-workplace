// WP-1479 formatKstDayClock — 개요 「프로젝트 상태」 카드의 갱신·다음 시각(「오늘 14:00」 / 「11월 11일 14:00」). 서울 기준.
import { describe, expect, it } from 'vitest'

import { formatKstDayClock } from './formatters'

// 기준: 2026-11-12 15:00 KST(= 06:00Z).
const NOW = new Date('2026-11-12T06:00:00Z')

describe('formatKstDayClock', () => {
  it('오늘이면 24시간 시각만, 오늘 표시를 주면 앞에 붙인다', () => {
    expect(formatKstDayClock('2026-11-12T14:00:00+09:00', NOW)).toBe('14:00')
    expect(formatKstDayClock('2026-11-12T05:00:00Z', NOW, '오늘')).toBe('오늘 14:00')
    expect(formatKstDayClock('2026-11-11T15:05:00Z', NOW, '오늘')).toBe('오늘 00:05') // 11-12 00:05 KST
  })
  it('오늘이 아니면 「M월 D일 HH:mm」', () => {
    expect(formatKstDayClock('2026-11-11T14:00:00+09:00', NOW, '오늘')).toBe('11월 11일 14:00')
    expect(formatKstDayClock('2026-11-13T09:00:00+09:00', NOW)).toBe('11월 13일 09:00')
  })
  it('무효 입력이면 빈 문자열', () => {
    expect(formatKstDayClock('', NOW)).toBe('')
    expect(formatKstDayClock('nope', NOW)).toBe('')
  })
})
