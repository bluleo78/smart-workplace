import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isReloadedDocumentEntry, reloadedDocumentUrl, resetDocumentPopForTests } from './documentNavigation'

/** 문서 다시 불러오기 판정 — F5·세션 복원은 새 선택이 아니다 (WP-2096). */
describe('isReloadedDocumentEntry', () => {
  const entry = (type: string, name = 'http://localhost/projects/WP?statusId=3') => ({ type, name })

  // 앞 테스트가 남긴 popstate 표시를 지운다 — 같은 파일의 테스트는 모듈 상태를 함께 쓴다.
  beforeEach(() => resetDocumentPopForTests())
  afterEach(() => vi.restoreAllMocks())

  it('reloadedDocumentUrl — reload·back_forward 면 문서 로드 주소, navigate·null·URL 아님이면 null', () => {
    expect(reloadedDocumentUrl(entry('reload'))?.search).toBe('?statusId=3')
    expect(reloadedDocumentUrl(entry('back_forward'))?.pathname).toBe('/projects/WP')
    expect(reloadedDocumentUrl(entry('navigate'))).toBeNull()
    expect(reloadedDocumentUrl(null)).toBeNull()
    expect(reloadedDocumentUrl(entry('reload', 'not a url'))).toBeNull()
  })

  it('reload 로 열린 같은 주소의 POP 이면 true', () => {
    expect(isReloadedDocumentEntry('POP', '/projects/WP', '?statusId=3', entry('reload'))).toBe(true)
  })

  it('back_forward 도 true', () => {
    expect(isReloadedDocumentEntry('POP', '/projects/WP', '?statusId=3', entry('back_forward'))).toBe(true)
  })

  it('navigate(새 진입·새 탭 링크)면 false', () => {
    expect(isReloadedDocumentEntry('POP', '/projects/WP', '?statusId=3', entry('navigate'))).toBe(false)
  })

  it('PUSH·REPLACE 면 false', () => {
    expect(isReloadedDocumentEntry('PUSH', '/projects/WP', '?statusId=3', entry('reload'))).toBe(false)
    expect(isReloadedDocumentEntry('REPLACE', '/projects/WP', '?statusId=3', entry('reload'))).toBe(false)
  })

  it('주소가 다르면 false', () => {
    expect(isReloadedDocumentEntry('POP', '/projects/WP', '?statusId=2', entry('reload'))).toBe(false)
  })

  it('entry.name 에 해시가 붙어도 true', () => {
    expect(
      isReloadedDocumentEntry('POP', '/projects/WP', '?statusId=3', entry('reload', 'http://localhost/projects/WP?statusId=3#x')),
    ).toBe(true)
  })

  it('퍼센트 인코딩 차이는 같은 주소로 본다', () => {
    expect(isReloadedDocumentEntry('POP', '/p', '?q=가', entry('reload', 'http://localhost/p?q=%EA%B0%80'))).toBe(true)
  })

  it('entry 가 null 이면 false', () => {
    expect(isReloadedDocumentEntry('POP', '/projects/WP', '?statusId=3', null)).toBe(false)
  })

  it('entry 생략 시 performance 에서 읽는다', () => {
    const spy = vi.spyOn(performance, 'getEntriesByType')
    spy.mockReturnValue([])
    expect(isReloadedDocumentEntry('POP', '/p', '?a=1')).toBe(false)
    spy.mockReturnValue([{ type: 'reload', name: 'http://localhost/p?a=1' }] as unknown as PerformanceEntryList)
    expect(isReloadedDocumentEntry('POP', '/p', '?a=1')).toBe(true)
  })

  it('entry.name 이 URL 이 아니면 throw 없이 false', () => {
    expect(isReloadedDocumentEntry('POP', '/p', '', entry('reload', 'not a url'))).toBe(false)
  })
})
