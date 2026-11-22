// contactResultAnnouncement 순수 함수 테스트(WP-1943) — 건수·이상·빈 결과 맥락별 문구.
import { describe, expect, it } from 'vitest'

import { contactResultAnnouncement } from './contactResultAnnouncement'

describe('contactResultAnnouncement', () => {
  it('목록 건수를 알린다', () => {
    expect(contactResultAnnouncement({ mode: 'list', count: 3, more: false, searching: true, favorite: false })).toBe('연락처 3명')
  })
  it('더 있으면 이상을 붙인다', () => {
    expect(contactResultAnnouncement({ mode: 'list', count: 50, more: true, searching: false, favorite: false })).toBe('연락처 50명 이상')
  })
  it('검색 중 0건은 검색 결과 없음', () => {
    expect(contactResultAnnouncement({ mode: 'list', count: 0, more: false, searching: true, favorite: true })).toBe('검색 결과가 없습니다')
  })
  it('즐겨찾기 0건', () => {
    expect(contactResultAnnouncement({ mode: 'list', count: 0, more: false, searching: false, favorite: true })).toBe('즐겨찾기한 연락처가 없습니다')
  })
  it('일반 0건', () => {
    expect(contactResultAnnouncement({ mode: 'list', count: 0, more: false, searching: false, favorite: false })).toBe('연락처가 없습니다')
  })
  it('그룹 모드 건수와 0건', () => {
    expect(contactResultAnnouncement({ mode: 'group', count: 2 })).toBe('하위 조직 포함 검색 결과 2명')
    expect(contactResultAnnouncement({ mode: 'group', count: 0 })).toBe('검색 결과가 없습니다')
  })
})
