import { describe, expect, it } from 'vitest'

import { displayLinkHref, normalizeLinkInput, openableHref } from './wikiLinkUrl'

describe('normalizeLinkInput — 링크 넣기 입력 주소 정규화(WP-312)', () => {
  it('빈 입력·공백만이면 null', () => {
    expect(normalizeLinkInput('')).toBeNull()
    expect(normalizeLinkInput('   ')).toBeNull()
  })

  it('스킴이 있는 주소는 그대로(앞뒤 공백만 제거)', () => {
    expect(normalizeLinkInput('  https://example.com/a?b=1#c ')).toBe('https://example.com/a?b=1#c')
    expect(normalizeLinkInput('http://intranet')).toBe('http://intranet')
    expect(normalizeLinkInput('mailto:dev@example.com')).toBe('mailto:dev@example.com')
    expect(normalizeLinkInput('tel:01012345678')).toBe('tel:01012345678')
  })

  it('맨 도메인·www 는 https:// 를 붙인다', () => {
    expect(normalizeLinkInput('example.com')).toBe('https://example.com')
    expect(normalizeLinkInput('www.example.com/docs?q=1')).toBe('https://www.example.com/docs?q=1')
    expect(normalizeLinkInput('localhost:6173/wiki')).toBe('https://localhost:6173/wiki')
    expect(normalizeLinkInput('docs.example.com:8080')).toBe('https://docs.example.com:8080')
  })

  it('점 없는 낱말은 주소로 보지 않는다(오타·일반 글자 방지)', () => {
    expect(normalizeLinkInput('설계문서')).toBeNull()
    expect(normalizeLinkInput('hello')).toBeNull()
  })

  it('스킴 뒤가 비었으면 거부', () => {
    expect(normalizeLinkInput('https://')).toBeNull()
    expect(normalizeLinkInput('http:// ')).toBeNull()
  })

  it('javascript:·data: 등 위험한 주소는 거부', () => {
    expect(normalizeLinkInput('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkInput(' JavaScript:alert(1)')).toBeNull()
    expect(normalizeLinkInput('data:text/html,<b>x</b>')).toBeNull()
  })

  it('공백·비ASCII 는 마크다운 경로와 같게 인코딩하고, 이미 인코딩된 값은 그대로(멱등)', () => {
    expect(normalizeLinkInput('https://example.com/a b')).toBe('https://example.com/a%20b')
    expect(normalizeLinkInput('https://example.com/문서')).toBe('https://example.com/%EB%AC%B8%EC%84%9C')
    const once = normalizeLinkInput('https://example.com/a%20b|c')
    expect(once).toBe('https://example.com/a%20b%7Cc')
    expect(normalizeLinkInput(once!)).toBe(once)
  })

  it('/ 로 시작하는 앱 안 경로는 그대로 둔다', () => {
    expect(normalizeLinkInput('/wiki/spaces/1/pages/2')).toBe('/wiki/spaces/1/pages/2')
  })

  it('// 로 시작하는 스킴 상대 주소는 거부(다른 호스트로 새는 것 방지)', () => {
    expect(normalizeLinkInput('//evil.example.com/x')).toBeNull()
    expect(normalizeLinkInput('///x')).toBeNull()
  })

  it('메일 주소는 https://user@host 가 아니라 mailto: 로 건다', () => {
    expect(normalizeLinkInput('dev@example.com')).toBe('mailto:dev@example.com')
    expect(normalizeLinkInput(' first.last+tag@mail.example.co.kr ')).toBe('mailto:first.last+tag@mail.example.co.kr')
    // 메일도 아닌 user@host/... 는 https://user@host 꼴이 되므로 거부한다.
    expect(normalizeLinkInput('user@example.com/path')).toBeNull()
  })
})

describe('displayLinkHref — 보이는 주소', () => {
  it('퍼센트 인코딩을 읽는 글자로 풀고, 깨진 인코딩은 그대로 둔다', () => {
    expect(displayLinkHref('https://example.com/%EB%AC%B8%EC%84%9C')).toBe('https://example.com/문서')
    expect(displayLinkHref('https://example.com/%E0%A4%A')).toBe('https://example.com/%E0%A4%A')
  })
})

describe('openableHref — 열어도 되는 주소', () => {
  it('허용 주소는 그대로, 빈 값·위험 주소는 null', () => {
    expect(openableHref(' https://example.com ')).toBe('https://example.com')
    expect(openableHref('mailto:a@b.co')).toBe('mailto:a@b.co')
    expect(openableHref('')).toBeNull()
    expect(openableHref(null)).toBeNull()
    expect(openableHref('javascript:alert(1)')).toBeNull()
  })
})
