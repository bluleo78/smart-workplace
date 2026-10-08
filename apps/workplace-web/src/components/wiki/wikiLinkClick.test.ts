// @vitest-environment jsdom
// 노트 링크 Ctrl/⌘+클릭 판정(WP-300).
import { describe, expect, it } from 'vitest'

import { wikiLinkHrefToOpen } from './wikiLinkClick'

/** <a href> 안의 <strong> 처럼 링크 안쪽 요소를 클릭한 상황을 만든다. */
function linkChild(href: string | null): Element {
  const a = document.createElement('a')
  if (href !== null) a.setAttribute('href', href)
  const inner = document.createElement('strong')
  a.appendChild(inner)
  return inner
}

describe('wikiLinkHrefToOpen', () => {
  it('편집 모드 + 수정키면 링크 주소를 돌려준다(링크 안쪽 요소를 눌러도)', () => {
    expect(wikiLinkHrefToOpen(linkChild('https://example.com'), { editable: true, modKey: true })).toBe('https://example.com')
  })

  it('수정키 없는 클릭은 열지 않는다 — 링크 글자 편집을 위한 클릭', () => {
    expect(wikiLinkHrefToOpen(linkChild('https://example.com'), { editable: true, modKey: false })).toBeNull()
  })

  it('보기 전용은 브라우저 기본 링크 동작에 맡긴다', () => {
    expect(wikiLinkHrefToOpen(linkChild('https://example.com'), { editable: false, modKey: true })).toBeNull()
  })

  it('위험한 주소·빈 주소·링크 밖 클릭은 열지 않는다', () => {
    expect(wikiLinkHrefToOpen(linkChild('javascript:alert(1)'), { editable: true, modKey: true })).toBeNull()
    expect(wikiLinkHrefToOpen(linkChild(' JavaScript:alert(1)'), { editable: true, modKey: true })).toBeNull()
    expect(wikiLinkHrefToOpen(linkChild(''), { editable: true, modKey: true })).toBeNull()
    expect(wikiLinkHrefToOpen(document.createElement('p'), { editable: true, modKey: true })).toBeNull()
  })
})
