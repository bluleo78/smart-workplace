import { describe, expect, it } from 'vitest'

import { bulkSelectionAnnouncement } from './bulkSelectionAnnouncement'

// WP-2065 — 일괄 작업 바 선택 개수 낭독 문구 순수 함수 검증
describe('bulkSelectionAnnouncement', () => {
  it('선택 1개면 단수 개수로 낭독 문구를 만든다', () => {
    expect(bulkSelectionAnnouncement(1)).toBe('선택 1개, 일괄 작업 사용 가능')
  })

  it('여러 개면 그 개수를 그대로 쓴다', () => {
    expect(bulkSelectionAnnouncement(12)).toBe('선택 12개, 일괄 작업 사용 가능')
  })

  it('선택이 없으면 빈 문구를 낸다(낭독하지 않는다)', () => {
    expect(bulkSelectionAnnouncement(0)).toBe('')
  })

  it('음수는 잘못된 값이라 빈 문구를 낸다', () => {
    expect(bulkSelectionAnnouncement(-1)).toBe('')
  })
})
