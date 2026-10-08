import { Editor } from '@tiptap/core'
import type { ResolvedPos, Slice } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { wikiSchemaExtensions } from './extensions'
import { docToMarkdown, markdownToDoc } from './markdown'

const roundTrip = (md: string) => docToMarkdown(markdownToDoc(md))

// WP-314 — 마크(굵게 등)가 끝난 바로 뒤의 소프트 줄바꿈이 파싱에서 지워져 '**a**b' 로 붙어 저장됐다.
// 원인은 tiptap-markdown normalizeDOM 이 요소 뒤 텍스트의 선행 \n 을 지우는 것 — 일반 텍스트 경로처럼 공백으로 남아야 한다.
describe('soft line break after a mark (WP-314)', () => {
  const cases: [string, string, string][] = [
    ['bold', '**a**\nb', '**a** b'],
    ['italic', '*a*\nb', '*a* b'],
    ['strike', '~~a~~\nb', '~~a~~ b'],
    ['code', '`a`\nb', '`a` b'],
    ['link', '[a](https://example.com)\nb', '[a](https://example.com) b'],
    ['image', '![](/api/v1/wiki/attachments/1)\nb', '![](/api/v1/wiki/attachments/1) b'],
    ['trailing space before break', '**a** \nb', '**a** b'],
    ['several in one paragraph', 'x **a**\nb **c**\nd', 'x **a** b **c** d'],
    ['mark between plain lines', 'a\n**b**\nc', 'a **b** c'],
    ['inside blockquote', '> 인용 **굵게**\n> 둘째 줄', '> 인용 **굵게** 둘째 줄'],
    ['inside list item', '- **a**\n  b', '- **a** b'],
    // 요소와 요소 사이 — 수정 전엔 사이 텍스트가 비어 두 굵게가 하나로 합쳐질 수 있었다.
    ['mark to mark', '**a**\n**b**', '**a** **b**'],
    ['mark to chip', '*a*\n<@5>', '*a* <@5>'],
    ['chip to mark', '<@5>\n**b**', '<@5> **b**'],
  ]

  it.each(cases)('%s: keeps the break as a space', (_name, md, expected) => {
    expect(roundTrip(md)).toBe(expected)
  })

  it.each(cases)('%s: is idempotent', (_name, md) => {
    const once = roundTrip(md)
    expect(roundTrip(once)).toBe(once)
  })

  it('keeps the words as separate text in the document', () => {
    const p = markdownToDoc('**a**\nb').firstChild
    expect(p?.textContent).toBe('a b')
  })

  // 하드 브레이크는 원래 <br> 노드로 남았다 — 수정 후에도 그대로여야 한다.
  it.each([
    ['two trailing spaces', '**a**  \nb'],
    ['backslash', '**a**\\\nb'],
  ])('hard break after a mark (%s) stays a hard break', (_name, md) => {
    expect(roundTrip(md)).toBe('**a**\\\nb')
    expect(markdownToDoc(md).firstChild?.child(1).type.name).toBe('hardBreak')
  })
})

// 골든 — 이 패턴이 없는 기존 노트는 수정 전과 바이트 단위로 같은 마크다운이 나와야 한다.
// 다르면 열기만 해도 리비전·3-way 병합에 가짜 diff 가 생긴다. 기대값은 수정 전 main(6c586c7e) 출력이다.
describe('serialization is unchanged for notes without the pattern (WP-314 golden)', () => {
  const golden: [string, string][] = [
    [
      '# 제목\n\n본문 **굵게** 와 *기울임* 과 ~~취소~~ 와 `코드` 와 [링크](https://example.com).',
      '# 제목\n\n본문 **굵게** 와 *기울임* 과 ~~취소~~ 와 `코드` 와 [링크](https://example.com).',
    ],
    ['첫 줄\n둘째 줄\n셋째 줄', '첫 줄 둘째 줄 셋째 줄'],
    ['줄 끝 하드브레이크  \n다음 줄\\\n그다음', '줄 끝 하드브레이크\\\n다음 줄\\\n그다음'],
    [
      '- 항목 **하나**\n- 항목 둘\n  - 중첩 *항목*\n\n1. 번호\n2. 번호 둘',
      '- 항목 **하나**\n- 항목 둘\n  - 중첩 *항목*\n\n1. 번호\n2. 번호 둘',
    ],
    ['```ts\nconst a = 1\n**not bold**\n```', '```ts\nconst a = 1\n**not bold**\n```'],
    ['| a | b |\n| --- | --- |\n| **x** | y \\| z |', '| a | b |\n| --- | --- |\n| **x** | y \\| z |\n'],
    ['![그림](/api/v1/wiki/attachments/1) 뒤 텍스트', '![그림](/api/v1/wiki/attachments/1) 뒤 텍스트'],
    ['- [ ] 할 일\n\n---\n\n끝 문단 **굵게** 끝.', '- \\[ \\] 할 일\n\n---\n\n끝 문단 **굵게** 끝.'],
    ['**a** b\n\n*c* d', '**a** b\n\n*c* d'],
    ['평문\n**굵게** 시작', '평문 **굵게** 시작'],
    // 헤더 없는 raw HTML 표(#742 폴백) — html_block 안의 태그 사이 개행은 normalizeDOM 이 계속 지워야 한다.
    [
      '<table><tr><td><strong>a</strong></td></tr>\n<tr><td>b</td></tr></table>',
      '<div class="tableWrapper">\n<table style="min-width: 25px;"><colgroup><col style="min-width: 25px;"></colgroup>' +
        '<tbody><tr><td colspan="1" rowspan="1"><p><strong>a</strong></p></td></tr>' +
        '<tr><td colspan="1" rowspan="1"><p>b</p></td></tr></tbody></table>\n</div>',
    ],
  ]

  it.each(golden)('%j', (md, expected) => {
    expect(roundTrip(md)).toBe(expected)
  })
})

// 붙여넣기 경로 — tiptap-markdown clipboardTextParser 는 preserveWhitespace 로 파싱해 \n 을 hardBreak 로 바꾼다.
// 소프트 줄바꿈을 공백으로 바꾸던 첫 수정은 여러 줄 붙여넣기를 한 줄로 접었다(리뷰 지적) — main 과 같이 줄이 남아야 한다.
describe('pasting markdown keeps line breaks (WP-314)', () => {
  /** 붙여넣기 파서를 직접 불러 슬라이스를 간단한 문자열로 바꾼다 — 텍스트는 마크 이름을 붙이고 hardBreak 는 ⏎. */
  function paste(text: string): string {
    const ed = new Editor({ extensions: wikiSchemaExtensions(), content: '<p>x</p>' })
    try {
      const plugin = ed.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('markdownClipboard'))
      const parse = plugin?.props.clipboardTextParser as unknown as (
        t: string, $ctx: ResolvedPos, plain: boolean, view: unknown,
      ) => Slice
      const parts: string[] = []
      parse(text, ed.state.doc.resolve(1), false, ed.view).content.descendants((n) => {
        if (n.type.name === 'hardBreak') parts.push('⏎')
        else if (n.isText) parts.push(n.marks.length ? `${n.marks.map((m) => m.type.name).join('+')}(${n.text})` : `(${n.text})`)
        else if (n.type.name === 'wikiMention') parts.push('@')
      })
      return parts.join('')
    } finally {
      ed.destroy()
    }
  }

  it.each([
    ['plain multi-line', 'a\nb', '(a)⏎(b)'],
    ['break after bold', '**a**\nb', 'bold(a)⏎(b)'],
    ['break after italic', '*a*\nb', 'italic(a)⏎(b)'],
    ['break after code', '`a`\nb', 'code(a)⏎(b)'],
    ['break after link', '[a](https://example.com)\nb', 'link(a)⏎(b)'],
    ['break after chip', '<@5>\nb', '@⏎(b)'],
    ['html br then newline', 'a<br>\nb', '(a)⏎(b)'],
    ['hard break after bold', '**a**  \nb', 'bold(a)⏎(b)'],
    // 요소 사이 \n 만 있는 경우 — 로드 경로를 위해 ' \n' 으로 둬서 앞 줄 끝에 공백 하나가 남는다(보이지 않음).
    ['bold to bold', '**a**\n**b**', 'bold(a)( )⏎bold(b)'],
    // 요소 뒤 \n 다음이 닫는 태그·블록이면 줄바꿈이 아니다 — main 과 같이 빈 hardBreak·공백이 생기면 안 된다.
    ['inline at paragraph end', '<p><strong>a</strong>\n</p>', 'bold(a)'],
    ['inline at list item end', '<ul><li><a href="https://example.com">a</a>\n</li></ul>', 'link(a)'],
    ['inline at table cell end', '<table><tr><td><em>a</em>\n</td></tr></table>', 'italic(a)'],
    ['inline before a block', '<div><img src="/api/v1/wiki/attachments/1">\n<p>b</p></div>', '(b)'],
  ])('%s', (_name, text, expected) => {
    expect(paste(text)).toBe(expected)
  })
})
