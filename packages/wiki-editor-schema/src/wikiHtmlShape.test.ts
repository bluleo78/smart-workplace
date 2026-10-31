// WP-1240 — HTML 모양 보존 라운드트립. 저장 형식(Markdown + HTML 블록)이 md → doc → md 로 안정적이고, 모양 속성이 보존되며,
// 위험 속성은 사라지고, 기존 노트(속성 없는 div·표 HTML 폴백·멘션·이미지·링크)는 바뀌지 않아야 한다.
import { describe, expect, it } from 'vitest'

import { docToMarkdown, getMarkdownSchema, markdownToDoc } from './markdown'

/** 한 번 저장한 결과와 그것을 다시 열어 저장한 결과 — 두 번째부터 같아야 한다. */
function roundtrip(md: string): { once: string; twice: string } {
  const once = docToMarkdown(markdownToDoc(md))
  return { once, twice: docToMarkdown(markdownToDoc(once)) }
}

const ARTIFACT = [
  '<style data-wp-style>',
  '.card{background:#0f172a;color:#fff;border-radius:12px;padding:16px}',
  '</style>',
  '',
  '# 일반 제목',
  '',
  '<div class="card" style="margin:8px">',
  '',
  '매출 **₩1.2B**, 성장 +18% <span class="badge" style="color:#16a34a">좋음</span>',
  '',
  '</div>',
].join('\n')

describe('HTML 모양 보존 (WP-1240)', () => {
  it('설계 예시 저장 형식은 바이트 그대로 라운드트립한다', () => {
    expect(docToMarkdown(markdownToDoc(ARTIFACT))).toBe(ARTIFACT)
  })

  it('설계 예시를 노드·마크로 읽는다(속성 보존)', () => {
    const doc = markdownToDoc(ARTIFACT).toJSON()
    expect(doc.content[0]).toEqual({
      type: 'wikiStyle',
      attrs: { css: '.card{background:#0f172a;color:#fff;border-radius:12px;padding:16px}' },
    })
    const box = doc.content[2]
    expect(box.type).toBe('wikiHtmlBox')
    expect(box.attrs).toEqual({ tag: 'div', className: 'card', style: 'margin:8px' })
    const badge = box.content[0].content.find((n: { text?: string }) => n.text === '좋음')
    expect(badge.marks).toEqual([{ type: 'wikiHtmlSpan', attrs: { className: 'badge', style: 'color:#16a34a' } }])
  })

  it('한 줄 HTML·중첩 영역·허용 태그는 빈 줄 형식으로 정리되고 그다음부터 안정적이다', () => {
    const { once, twice } = roundtrip('<section class="a"><div style="display:grid">x</div><p>y</p></section>')
    expect(once).toBe(['<section class="a">', '', '<div style="display:grid">', '', 'x', '', '</div>', '', 'y', '', '</section>'].join('\n'))
    expect(twice).toBe(once)
  })

  it('목록 안 영역은 들여쓰기를 유지한다', () => {
    const md = ['- 항목', '', '  <aside class="note">', '', '  안쪽 **굵게**', '', '  </aside>'].join('\n')
    expect(roundtrip(md).once).toBe(md)
  })

  it('영역 안 표·목록·멘션·이미지·링크도 그대로다', () => {
    const md = [
      '<div class="card">',
      '',
      '| a | b |',
      '| --- | --- |',
      '| <@3> | [링크](https://example.com) |',
      '',
      '- ![](/api/v1/wiki/attachments/1)',
      '- <#page:12>',
      '',
      '</div>',
    ].join('\n')
    const { once, twice } = roundtrip(md)
    expect(once).toBe(md)
    expect(twice).toBe(once)
  })

  it('span 은 다른 마크 바깥에 써서 강조 규칙이 깨지지 않는다', () => {
    const { once, twice } = roundtrip('가<strong><span class="x">나</span></strong>다 <span class="y">a <em>b</em> c</span>')
    expect(once).toBe('가<span class="x">**나**</span>다 <span class="y">a *b* c</span>')
    expect(twice).toBe(once)
    const p = markdownToDoc(once).firstChild!
    expect(p.child(1).marks.map((m) => m.type.name)).toEqual(['wikiHtmlSpan', 'bold'])
  })

  it('중첩 span 은 둘 다 남는다', () => {
    const md = '<span class="a"><span style="color:red">중첩</span></span>'
    expect(roundtrip(md).once).toBe(md)
  })

  it('위험 속성·선언은 지우고 안전한 것만 남긴다', () => {
    const { once, twice } = roundtrip(
      '<div class="x &quot;y" style="background:url(javascript:alert(1)); color:red" onclick="x()">t <span style="width:expression(1)" onmouseover="x()">s</span></div>',
    )
    expect(once).toBe(['<div class="x" style="color:red">', '', 't s', '', '</div>'].join('\n'))
    expect(twice).toBe(once)
  })

  it('페이지 스타일의 @import·위험 선언을 지운다', () => {
    const md = ['<style data-wp-style>', '@import url(https://evil/x.css);', '.a{color:red;background:url(http://t/x.png)}', '</style>'].join('\n')
    const { once, twice } = roundtrip(md)
    expect(once).toBe(['<style data-wp-style>', '.a{color:red;}', '</style>'].join('\n'))
    expect(twice).toBe(once)
  })

  // 마크다운으로는 </style> 을 CSS 안에 넣을 수 없지만(그 줄에서 블록이 끝난다) Yjs 로 들어온 attrs 는 파싱을 거치지 않는다.
  it('문서 attrs 의 </style> 은 직렬화 때 무력화해 HTML 블록을 일찍 끝내지 않는다', () => {
    const doc = getMarkdownSchema().nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'wikiStyle', attrs: { css: '.b::after{content:"</style><script>x"}' } },
        { type: 'wikiHtmlBox', attrs: { tag: 'script', className: 'c" onclick="x', style: 'color:red;x:expression(1)' }, content: [{ type: 'paragraph' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '끝' }] },
      ],
    })
    const once = docToMarkdown(doc)
    expect(once).toBe(
      ['<style data-wp-style>', '.b::after{content:"<\\/style><script>x"}', '</style>', '', '<div style="color:red">', '', '</div>', '', '끝'].join('\n'),
    )
    const again = markdownToDoc(once)
    expect(again.child(0).attrs.css).toBe('.b::after{content:"<\\/style><script>x"}')
    expect(again.child(again.childCount - 1).textContent).toBe('끝')
  })

  it('빈 줄이 든 CSS 도 한 덩어리로 읽고, 저장 때 빈 줄을 뺀다', () => {
    const md = ['<style data-wp-style>', '.a{color:red}', '', '  ', '.b{color:blue}', '</style>', '', '본문'].join('\n')
    const { once, twice } = roundtrip(md)
    expect(once).toBe(['<style data-wp-style>', '.a{color:red}', '.b{color:blue}', '</style>', '', '본문'].join('\n'))
    expect(twice).toBe(once)
  })

  // 병합 셀 표는 6번 종류 HTML 블록(빈 줄에서 끝난다)으로 저장된다 — 셀 안 페이지 스타일 CSS 에 빈 줄이 있으면 표가 끊긴다.
  it('HTML 로 폴백하는 표 셀 안의 페이지 스타일도 빈 줄 없이 써서 표가 끊기지 않는다', () => {
    const cell = (content: object[], attrs: object = {}) => ({ type: 'tableCell', attrs, content })
    const doc = getMarkdownSchema().nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell([{ type: 'paragraph', content: [{ type: 'text', text: '병합' }] }], { colspan: 2 })] },
            {
              type: 'tableRow',
              content: [
                cell([{ type: 'wikiStyle', attrs: { css: '.a{color:red}\n\n\n.b{color:blue}' } }]),
                cell([{ type: 'paragraph', content: [{ type: 'text', text: '나' }] }]),
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '끝' }] },
      ],
    })
    const once = docToMarkdown(doc)
    expect(once).not.toMatch(/\.a\{color:red\}\n\s*\n/)
    const again = markdownToDoc(once)
    expect(again.child(0).type.name).toBe('table')
    expect(again.childCount).toBe(2)
    let css: string | null = null
    again.descendants((n) => {
      if (n.type.name === 'wikiStyle') css = n.attrs.css
    })
    expect(css).toBe('.a{color:red}\n.b{color:blue}')
    expect(docToMarkdown(again)).toBe(once)
  })

  // markdown-it 은 표 행을 HTML 해석 전에 | 로 나눈다 — 속성값의 | 는 &#124; 로 써야 셀이 쪼개지지 않는다.
  it('GFM 표 셀 안 인라인 모양 속성의 | 는 &#124; 로 써서 셀이 쪼개지지 않고 값은 그대로 돌아온다', () => {
    const md = ['| a | b |', '| --- | --- |', '| <span style="font-family:&quot;A&#124;B&quot;">x</span> | y |'].join('\n')
    const { once, twice } = roundtrip(md)
    // 표 직렬화기는 표 끝에 줄바꿈 하나를 더 쓴다(기존 동작).
    expect(once.trimEnd()).toBe(md)
    expect(twice).toBe(once)
    const doc = markdownToDoc(once)
    const row = doc.child(0).child(1)
    expect(row.childCount).toBe(2)
    const x = row.child(0).firstChild!.firstChild!
    expect(x.text).toBe('x')
    expect(x.marks[0].attrs.style).toBe('font-family:"A|B"')
  })

  it('표지 없는 <style> 은 지금처럼 버린다', () => {
    expect(roundtrip('<style>.a{color:red}</style>\n\n본문').once).toBe('본문')
  })

  describe('기존 노트 회귀 없음', () => {
    it('속성 없는 <div>·<span> 은 노드·마크를 만들지 않고 내용만 살린다', () => {
      const doc = markdownToDoc('<div>plain <span>s</span></div>')
      expect(doc.toJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain s' }] }] })
    })

    it('정리 후 남는 속성이 없으면 영역을 만들지 않는다', () => {
      expect(markdownToDoc('<div class="&lt;x&gt;" style="width:expression(1)">t</div>').firstChild!.type.name).toBe('paragraph')
    })

    it('표 HTML 폴백의 div.tableWrapper 는 영역으로 잡지 않는다(#754)', () => {
      const html = '<table><tbody><tr><td colspan="2">병합</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>'
      const { once, twice } = roundtrip(html)
      expect(markdownToDoc(once).firstChild!.type.name).toBe('table')
      expect(once.startsWith('<div class="tableWrapper">')).toBe(true)
      expect(twice).toBe(once)
    })

    it('표·멘션·이미지·링크·코드가 든 일반 노트는 바이트 그대로다', () => {
      const md = [
        '# 회의록',
        '',
        '<@3> 님이 <#page:12> 를 고쳤다. [링크](https://example.com "t") `code`',
        '',
        '![그림](/api/v1/wiki/attachments/1)',
        '',
        '| a | b |',
        '| --- | ---: |',
        '| 1 | 2 \\| 3 |',
        '',
        '```html',
        '<div class="card">x</div>',
        '```',
      ].join('\n')
      expect(roundtrip(md).once).toBe(md)
    })

    it('본문 글자의 <div class=…> 는 이스케이프된 글자 그대로다', () => {
      const md = '설명: &lt;div class="card"&gt; 를 쓴다'
      expect(roundtrip(md).once).toBe(md)
    })
  })
})

// WP-1241 — Tailwind 정적 내보내기의 class(변형·임의값)가 모양 영역·인라인 모양·표 셀 안에서 저장 → 다시 열기에 그대로 남는다.
describe('Tailwind 류 class 토큰 (WP-1241)', () => {
  const TOKENS = ['md:grid-cols-2', 'w-1/2', 'gap-0.5', 'w-[calc(100%-2rem)]', 'bg-[#0f172a]', '!mt-0', '@container', 'grid-cols-[1fr,2fr]', '[mask-type=luminance]']

  it.each(TOKENS)('%s — 모양 영역·인라인 모양이 md → doc → md 로 바이트 그대로다', (token) => {
    const md = [`<div class="${token} card">`, '', `글 <span class="${token}">배지</span> 끝`, '', '</div>'].join('\n')
    const doc = markdownToDoc(md)
    expect(doc.firstChild!.attrs.className).toBe(`${token} card`)
    const span = doc.firstChild!.firstChild!.child(1)
    expect(span.marks[0].attrs.className).toBe(token)
    expect(docToMarkdown(doc)).toBe(md)
  })

  it('GFM 표 셀 안 인라인 모양의 Tailwind class 도 셀을 깨지 않고 왕복한다', () => {
    const md = ['| a | b |', '| --- | --- |', '| <span class="md:text-lg w-[calc(100%-2rem)] bg-[#0f172a]">x</span> | y |'].join('\n')
    const { once, twice } = roundtrip(md)
    // 표 직렬화기는 표 뒤에 줄바꿈 하나를 붙인다(기존 동작) — 표 줄은 바이트 그대로이고 두 번째 저장부터 같다.
    expect(once.trimEnd()).toBe(md)
    expect(twice).toBe(once)
    const cell = markdownToDoc(md).firstChild!.child(1).child(0)
    expect(cell.textContent).toBe('x')
  })

  it('위험 글자가 든 토큰은 여전히 버린다(나머지 토큰은 남는다)', () => {
    const doc = markdownToDoc('<div class="ok a{b a;b a`b a\\b">\n\nx\n\n</div>')
    expect(doc.firstChild!.attrs.className).toBe('ok')
  })
})
