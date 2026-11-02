// WP-1300 — HTML 블록 소스 칸 색 구분 토크나이저(순수 함수). 토큰 종류·범위를 글자로 바꿔 비교한다.
import { describe, expect, it } from 'vitest'

import { type HtmlTokenType, tokenizeHtml } from './wikiHtmlEmbedHighlight'

/** 토큰을 [종류, 그 글자] 쌍으로 — 위치 숫자보다 읽기 쉽게. */
const pieces = (src: string): Array<[HtmlTokenType, string]> => tokenizeHtml(src).map((t) => [t.type, src.slice(t.from, t.to)])

describe('tokenizeHtml', () => {
  it('태그·속성 이름·따옴표 값·따옴표 없는 값·닫는 태그를 나누고 보통 글자는 토큰이 없다', () => {
    expect(pieces('<div class="a b" data-x=1 hidden>글 <b>굵게</b></div>')).toEqual([
      ['tag', '<div'],
      ['attr', 'class'],
      ['value', '"a b"'],
      ['attr', 'data-x'],
      ['value', '1'],
      ['attr', 'hidden'],
      ['tag', '>'],
      ['tag', '<b'],
      ['tag', '>'],
      ['tag', '</b'],
      ['tag', '>'],
      ['tag', '</div'],
      ['tag', '>'],
    ])
  })

  it('주석·doctype·스스로 닫는 태그·홑따옴표 값', () => {
    expect(pieces("<!DOCTYPE html>\n<!-- 메모 <b> -->\n<img src='x.png' />")).toEqual([
      ['doctype', '<!DOCTYPE html>'],
      ['comment', '<!-- 메모 <b> -->'],
      ['tag', '<img'],
      ['attr', 'src'],
      ['value', "'x.png'"],
      ['tag', '/>'],
    ])
  })

  it('script·style 몸통은 보통 글자다 — 안의 < 와 따옴표를 태그·값으로 보지 않는다(대소문자 무시)', () => {
    const src = '<script>if (a < b) s = "<p>"</SCRIPT><style>a::before{content:"<i>"}</style>'
    expect(pieces(src)).toEqual([
      ['tag', '<script'],
      ['tag', '>'],
      ['tag', '</SCRIPT'],
      ['tag', '>'],
      ['tag', '<style'],
      ['tag', '>'],
      ['tag', '</style'],
      ['tag', '>'],
    ])
  })

  it('이름 없는 < 는 보통 글자, 닫히지 않은 주석·따옴표·script 는 소스 끝까지', () => {
    expect(pieces('1 < 2 <!-- 끝없음')).toEqual([['comment', '<!-- 끝없음']])
    expect(pieces('<a href="열림')).toEqual([
      ['tag', '<a'],
      ['attr', 'href'],
      ['value', '"열림'],
    ])
    expect(pieces('<script>var x = "<b>"')).toEqual([
      ['tag', '<script'],
      ['tag', '>'],
    ])
  })

  it('빈 소스·태그 없는 글자는 토큰이 없다', () => {
    expect(tokenizeHtml('')).toEqual([])
    expect(tokenizeHtml('그냥 글자')).toEqual([])
  })
})
