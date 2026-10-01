import { describe, expect, it } from 'vitest'

import { EMPTY_PREVIEW, previewLine } from './conversationPreview'

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
