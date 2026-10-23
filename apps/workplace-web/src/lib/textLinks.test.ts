import { describe, expect, it } from 'vitest'

import { linkifyText, linkVersion } from './textLinks'

// 링크 세그먼트의 텍스트만 뽑는다 — 경계 판정 케이스를 짧게 쓰기 위해.
const links = (s: string) => linkifyText(s).filter((x) => x.type === 'link').map((x) => x.text)

// 채팅 자동 링크 추출 규칙(WP-874) — 서버 추출기와 같은 경계여야 한다.
describe('linkifyText', () => {
  it('URL 이 없으면 원문 하나짜리 text', () => {
    expect(linkifyText('안녕하세요')).toEqual([{ type: 'text', text: '안녕하세요' }])
    expect(linkifyText('')).toEqual([])
  })

  it('앞뒤 글과 링크를 나누고 href 를 단다', () => {
    expect(linkifyText('이거 https://github.com/a/b 보세요')).toEqual([
      { type: 'text', text: '이거 ' },
      { type: 'link', text: 'https://github.com/a/b', href: 'https://github.com/a/b' },
      { type: 'text', text: ' 보세요' },
    ])
  })

  it('www. 시작은 href 에 https:// 를 붙인다', () => {
    expect(linkifyText('www.example.com/notes')).toEqual([
      { type: 'link', text: 'www.example.com/notes', href: 'https://www.example.com/notes' },
    ])
  })

  it('http·대문자 스킴도 링크', () => {
    expect(links('HTTP://A.COM 와 http://b.com')).toEqual(['HTTP://A.COM', 'http://b.com'])
  })

  it('끝 문장부호는 뺀다', () => {
    expect(links('봐요 https://a.com.')).toEqual(['https://a.com'])
    expect(links('https://a.com, https://b.com! https://c.com?')).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    expect(links("'https://a.com/x'")).toEqual(['https://a.com/x'])
    expect(links('https://a.com/x...;:')).toEqual(['https://a.com/x'])
  })

  it('쿼리의 ? 와 # 은 가운데면 남긴다', () => {
    expect(links('https://a.com/p?q=1&r=2#frag 끝')).toEqual(['https://a.com/p?q=1&r=2#frag'])
  })

  it('짝 없는 닫는 괄호는 빼고, 짝이 맞으면 남긴다', () => {
    expect(links('(see https://a.com).')).toEqual(['https://a.com'])
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
    expect(links('[https://a.com/x]')).toEqual(['https://a.com/x'])
    expect(links('(https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  })

  it('비-ASCII(한글)에서 끝난다', () => {
    expect(linkifyText('https://a.com에서 봤어요')).toEqual([
      { type: 'link', text: 'https://a.com', href: 'https://a.com' },
      { type: 'text', text: '에서 봤어요' },
    ])
  })

  it('공백·꺾쇠·큰따옴표에서 끝난다', () => {
    expect(links('<https://a.com/x>')).toEqual(['https://a.com/x'])
    expect(links('"https://a.com/y"')).toEqual(['https://a.com/y'])
    expect(links('https://a.com/1\nhttps://a.com/2')).toEqual(['https://a.com/1', 'https://a.com/2'])
  })

  it('앞이 ASCII 단어 문자면 시작으로 보지 않는다', () => {
    expect(links('xhttps://a.com')).toEqual([])
    expect(links('abcwww.a.com')).toEqual([])
    // 한글 바로 뒤는 비-단어 문자 뒤로 본다.
    expect(links('링크:https://a.com')).toEqual(['https://a.com'])
  })

  it('접두사만 있으면 링크가 아니다', () => {
    expect(links('https:// 와 www. 만')).toEqual([])
  })

  it('멘션 토큰과 섞인 원문은 호출처가 text 세그먼트에만 적용한다 — 꺾쇠에서 끊긴다', () => {
    expect(links('https://a.com<@12>')).toEqual(['https://a.com'])
  })
})

// 썸네일 캐시 무효화 버전(WP-874) — 같은 링크면 같은 값, 다른 링크면 다른 값.
describe('linkVersion', () => {
  it('결정적이고 링크마다 다르다', () => {
    expect(linkVersion('https://a.com/x')).toBe(linkVersion('https://a.com/x'))
    expect(linkVersion('https://a.com/x')).not.toBe(linkVersion('https://a.com/y'))
    expect(linkVersion('https://a.com/x')).toMatch(/^[0-9a-z]+$/)
  })
})
