import { describe, expect, it } from 'vitest'

import { EMPTY_PREVIEW, formatListTime, previewLine } from './conversationPreview'

// 기준 시각: 2026-10-01 15:00 KST(= 06:00Z). 시간 표기는 Asia/Seoul 기준.
const NOW = new Date('2026-10-01T06:00:00Z')

describe('formatListTime', () => {
  it('오늘이면 오전/오후 시각', () => {
    expect(formatListTime('2026-10-01T04:05:00Z', NOW)).toBe('오후 1:05') // 13:05 KST
    expect(formatListTime('2026-09-30T15:00:00Z', NOW)).toBe('오전 12:00') // 10-01 00:00 KST(자정 직후 = 오늘)
  })
  it('어제면 "어제" — 자정 직전 포함', () => {
    expect(formatListTime('2026-09-30T14:59:00Z', NOW)).toBe('어제') // 09-30 23:59 KST
    expect(formatListTime('2026-09-29T15:00:00Z', NOW)).toBe('어제') // 09-30 00:00 KST
  })
  it('올해 그 이전이면 "M월 D일"', () => {
    expect(formatListTime('2026-09-28T03:00:00Z', NOW)).toBe('9월 28일')
    expect(formatListTime('2026-01-01T00:00:00Z', NOW)).toBe('1월 1일')
  })
  it('작년 이전이면 "YYYY. M. D."', () => {
    expect(formatListTime('2025-12-31T05:00:00Z', NOW)).toBe('2025. 12. 31.')
    expect(formatListTime('2025-12-03T05:00:00Z', NOW)).toBe('2025. 12. 3.')
  })
  it('무효 입력이면 빈 문자열', () => {
    expect(formatListTime('', NOW)).toBe('')
  })
})

describe('previewLine', () => {
  const base = { id: 1, authorId: 2, authorName: '김철수', preview: '안녕하세요', createdAt: '2026-10-01T04:05:00Z' }

  it('메시지 없음', () => {
    expect(previewLine(null, { meId: 1, isOneToOneDm: false })).toBe(EMPTY_PREVIEW)
    expect(previewLine(undefined, { meId: 1, isOneToOneDm: true })).toBe(EMPTY_PREVIEW)
  })
  it('내 메시지는 어디서나 "나: "', () => {
    expect(previewLine({ ...base, authorId: 1 }, { meId: 1, isOneToOneDm: false })).toBe('나: 안녕하세요')
    expect(previewLine({ ...base, authorId: 1 }, { meId: 1, isOneToOneDm: true })).toBe('나: 안녕하세요')
  })
  it('1:1 DM 상대 메시지는 접두 없음', () => {
    expect(previewLine(base, { meId: 1, isOneToOneDm: true })).toBe('안녕하세요')
  })
  it('채널·그룹 DM 은 "이름: "', () => {
    expect(previewLine(base, { meId: 1, isOneToOneDm: false })).toBe('김철수: 안녕하세요')
  })
  it('작성자 이름이 없으면(탈퇴 등) 접두 없이', () => {
    expect(previewLine({ ...base, authorName: null }, { meId: 1, isOneToOneDm: false })).toBe('안녕하세요')
  })
})
