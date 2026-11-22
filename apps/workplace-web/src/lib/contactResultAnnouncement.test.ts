// contactResultAnnouncement 순수 함수 테스트(WP-1943) — 건수·이상·빈 결과 맥락별 문구와 조건 키.
import { describe, expect, it } from 'vitest'

import { contactResultAnnouncement, contactResultKey } from './contactResultAnnouncement'

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

describe('contactResultKey', () => {
  // 자유 입력에 구분자가 들어가도 조건이 갈려야 한다 — 옛 `list|…|조직|직책` 연결은 `a|b`+`c` 와 `a`+`b|c` 를 같은 키로 만들었다.
  it('조직·직책에 구분자가 있어도 다른 조건은 다른 키다', () => {
    const first = contactResultKey({ mode: 'list', query: '', type: 'ALL', organization: 'a|b', title: 'c' })
    const second = contactResultKey({ mode: 'list', query: '', type: 'ALL', organization: 'a', title: 'b|c' })
    expect(first).not.toBe(second)
  })

  it('검색어·보기가 달라도 다른 키다', () => {
    const base = { mode: 'list' as const, type: 'ALL' as const, organization: '', title: '' }
    expect(contactResultKey({ ...base, query: 'kim' })).not.toBe(contactResultKey({ ...base, query: 'lee' }))
    expect(contactResultKey({ ...base, query: '', type: 'MEMBER' })).not.toBe(contactResultKey({ ...base, query: '' }))
  })

  it('같은 조건은 늘 같은 키다', () => {
    const condition = { mode: 'list' as const, query: 'kim', type: 'MEMBER' as const, organization: '본부', title: '팀장' }
    expect(contactResultKey(condition)).toBe(contactResultKey({ ...condition }))
  })

  it('그룹 조건은 그룹 id 와 검색어로 갈린다', () => {
    expect(contactResultKey({ mode: 'group', groupId: 10, query: 'a' })).not.toBe(
      contactResultKey({ mode: 'group', groupId: 11, query: 'a' }),
    )
    expect(contactResultKey({ mode: 'group', groupId: 10, query: 'a' })).not.toBe(
      contactResultKey({ mode: 'group', groupId: 10, query: 'b' }),
    )
  })
})
