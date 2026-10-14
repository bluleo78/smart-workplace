// MarkdownMessage 의 포맷용 공백 정리(stripLayoutWhitespace) — pre-wrap(p·li) 아래에서 빈 줄·빈 칸으로 그려질 텍스트가 남지 않는지 마크업으로 확인한다.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MarkdownMessage } from './MarkdownMessage'

const render = (md: string) => renderToStaticMarkup(createElement(MarkdownMessage, null, md))

describe('MarkdownMessage 포맷용 공백 정리', () => {
  it('tight list 항목 사이·항목 안 블록 옆 개행을 지우고 항목 안 줄바꿈은 남긴다', () => {
    const html = render('1. a\n2. b\n이어지는 문장')
    expect(html).toContain('<ol class="list-decimal space-y-0.5 pl-5"><li class="whitespace-pre-wrap">a</li><li')
    expect(html).toContain('>b\n이어지는 문장</li></ol>')
  })

  it('loose list 의 li 안 문단 옆 개행을 지운다', () => {
    const html = render('- a\n\n- b')
    expect(html).toMatch(/<li class="whitespace-pre-wrap"><p[^>]*>a<\/p><\/li><li/)
  })

  it('체크박스 뒤 공백을 지운다', () => {
    const html = render('- [ ] a\n- [x] b')
    expect(html).toMatch(/<input[^>]*>a<\/li>/)
    expect(html).toMatch(/<input[^>]*>b<\/li>/)
  })

  it('하드 브레이크 뒤 개행은 지우고 인라인 사이 soft break 는 남긴다', () => {
    expect(render('a  \nb')).toContain('a<br/>b')
    expect(render('**a**\n*b*')).toContain('<strong class="font-semibold">a</strong>\n<em>b</em>')
  })

  it('각주(section)처럼 목록에 늦게 추가된 블록 사이에도 포맷용 공백이 남지 않는다', () => {
    const html = render('본문[^1]\n\n[^1]: 각주 내용')
    expect(html).toContain('<section')
    // 블록 태그 사이에 공백 전용 텍스트가 끼지 않는다(pre-wrap 아래에서 빈 줄로 그려진다).
    expect(html).not.toMatch(/<\/(p|ol|li|h2|section)>\s+</)
    expect(html).not.toMatch(/<(ol|li|section)[^>]*>\s+</)
  })
})
