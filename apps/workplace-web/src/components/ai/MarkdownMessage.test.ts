// MarkdownMessage 의 포맷용 공백 정리(stripLayoutWhitespace) — pre-wrap(p·li) 아래에서 빈 줄·빈 칸으로 그려질 텍스트가 남지 않는지 마크업으로 확인한다.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
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

describe('MarkdownMessage 내부 링크 (WP-384)', () => {
  const ID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f'
  const inRouter = (md: string) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(MarkdownMessage, { internalLinks: true, children: md })))

  it('internalLinks 면 상대 경로는 새 탭이 아닌 라우터 링크, 외부 링크는 그대로 새 탭', () => {
    const html = inRouter(`[지난 대화](/?aiChat=${ID}) · [외부](https://example.com)`)
    // 라우터 Link 의 속성 순서는 라이브러리가 정한다 — 그 a 하나를 떼어 속성만 본다.
    const internal = html.match(/<a [^>]*data-testid="markdown-internal-link"[^>]*>지난 대화<\/a>/)?.[0]
    expect(internal).toBeDefined()
    expect(internal).toContain(`href="/?aiChat=${ID}"`)
    expect(internal).not.toContain('target=')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer" class="text-primary underline">외부</a>')
  })

  it('internalLinks 가 없거나 라우터 밖이면 이전처럼 모두 새 탭', () => {
    expect(render(`[지난 대화](/?aiChat=${ID})`)).toContain('target="_blank"')
    expect(renderToStaticMarkup(createElement(MarkdownMessage, { internalLinks: true, children: '[a](/x)' }))).toContain('target="_blank"')
  })

  it('대화 링크는 지금 화면 경로·쿼리에 aiChat 만 더한다 — 다른 화면 링크는 그 경로 그대로', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/projects/WP?issue=WP-1'] },
        createElement(MarkdownMessage, { internalLinks: true, children: `[대화](/?aiChat=${ID}) [이슈](/projects/WP/issues/2)` }),
      ),
    )
    expect(html).toContain(`href="/projects/WP?issue=WP-1&amp;aiChat=${ID}"`)
    expect(html).toContain('href="/projects/WP/issues/2"')
  })
})

// WP-1009: 채팅의 AI 글 — 멘션 토큰 <@id> 를 호출자가 주는 칩으로 그린다(사람 글과 같은 칩).
describe('MarkdownMessage 멘션 칩', () => {
  const mentions = [{ id: 7, name: '김철수', kind: 'HUMAN' as const }]
  const chip = (m: { id: number; name: string; kind: string }, key: string) =>
    createElement('span', { key, 'data-testid': `chip-${m.id}`, 'data-kind': m.kind }, `@${m.name}`)
  const renderWithMentions = (md: string) =>
    renderToStaticMarkup(createElement(MarkdownMessage, { mentions, renderMention: chip, children: md }))

  it('토큰을 칩으로 바꾸고 마크다운 서식은 그대로 둔다', () => {
    const html = renderWithMentions('<@7> 리뷰 **부탁**해요')
    expect(html).toContain('<span data-testid="chip-7" data-kind="HUMAN">@김철수</span> 리뷰 <strong class="font-semibold">부탁</strong>해요')
    expect(html).not.toContain('&lt;@')
  })

  it('mentions 에 없는 id 는 「알 수 없음」 사람 칩', () => {
    expect(renderWithMentions('<@99> 확인')).toContain('<span data-testid="chip-99" data-kind="HUMAN">@알 수 없음</span>')
  })

  it('코드 안의 토큰은 글자 그대로 둔다', () => {
    const html = renderWithMentions('`<@7>` 와\n\n```\n<@7>\n```')
    expect(html).not.toContain('chip-7')
    expect(html).toContain('&lt;@7&gt;</code>')
  })

  it('목록·강조 안의 토큰도 칩으로', () => {
    const html = renderWithMentions('- **<@7>** 담당')
    expect(html).toContain('<strong class="font-semibold"><span data-testid="chip-7" data-kind="HUMAN">@김철수</span></strong>')
  })

  it('renderMention 이 없으면(AI 패널 등) 토큰을 다루지 않는다', () => {
    expect(render('<@7> 확인')).toContain('&lt;@7&gt; 확인')
  })
})

// 한국어 굵게(WP-1633) — 닫는 ** 앞이 문장부호(괄호·따옴표·코드)이고 바로 뒤에 조사가 붙어도 굵게로 닫힌다(CommonMark 만으로는 ** 가 기호째 남는다).
describe('MarkdownMessage 한국어 굵게', () => {
  it.each([
    ['**설정(A)**을 누르세요', '<strong class="font-semibold">설정(A)</strong>을 누르세요'],
    ['**"허용"**으로 바꿉니다', '<strong class="font-semibold">&quot;허용&quot;</strong>으로 바꿉니다'],
    ['**「저장」**을 누르면', '<strong class="font-semibold">「저장」</strong>을 누르면'],
  ])('%j', (md, expected) => {
    const html = render(md)
    expect(html).toContain(expected)
    expect(html).not.toContain('**')
  })

  it('코드 표기를 굵게 감싸고 조사가 붙어도 굵게 안의 코드로 그린다', () => {
    const html = render('**`VBR`**을 고릅니다')
    expect(html).toMatch(/<strong class="font-semibold"><code[^>]*>VBR<\/code><\/strong>을 고릅니다/)
    expect(html).not.toContain('**')
  })

  it('취소선도 문장부호 뒤 조사 앞에서 닫힌다', () => {
    const html = render('~~취소(A)~~를 확인')
    expect(html).toContain('<del>취소(A)</del>를 확인')
    expect(html).not.toContain('~~')
  })

  it('영문 강조 규칙은 그대로 — 단어 안 밑줄은 강조가 아니다', () => {
    expect(render('snake_case_name')).toContain('snake_case_name')
    expect(render('**bold**')).toContain('<strong class="font-semibold">bold</strong>')
  })
})
