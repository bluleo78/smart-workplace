import { Editor } from '@tiptap/core'
import type MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import { wikiSchemaExtensions } from './extensions'
import { docToMarkdown, markdownToDoc } from './markdown'

// 멘션 토큰은 파싱 단계에서 칩 노드가 되고, 코드 안에서는 글자 그대로 남아야 한다.
describe('mention tokens in markdown', () => {
  it('parses tokens into wikiMention nodes without label', () => {
    const doc = markdownToDoc('담당 <@5> 참고 <#page:12> 이슈 <#issue:34>')
    const mentions: unknown[] = []
    doc.descendants((n) => { if (n.type.name === 'wikiMention') mentions.push(n.attrs) })
    expect(mentions).toEqual([
      { mtype: 'USER', id: 5 },
      { mtype: 'PAGE', id: 12 },
      { mtype: 'ISSUE', id: 34 },
    ])
  })

  it('round-trips tokens unchanged', () => {
    const md = '담당 <@5> 참고 <#page:12>'
    expect(docToMarkdown(markdownToDoc(md))).toBe(md)
  })

  it('keeps tokens inside inline code and code blocks as text', () => {
    const md = '인라인 `<@5>` 끝\n\n```\n<#page:12>\n```'
    const doc = markdownToDoc(md)
    let count = 0
    doc.descendants((n) => { if (n.type.name === 'wikiMention') count++ })
    expect(count).toBe(0)
    expect(docToMarkdown(doc)).toBe(md)
  })

  it('parses tokens inside table cells', () => {
    const md = '| 담당 |\n| --- |\n| <@5> |\n'
    let count = 0
    markdownToDoc(md).descendants((n) => { if (n.type.name === 'wikiMention') count++ })
    expect(count).toBe(1)
  })

  // 칩 바로 뒤 소프트 줄바꿈 — tiptap-markdown normalizeDOM 이 요소 뒤 텍스트의 선행 \n 을 지우므로
  // 그대로 두면 '<@5>다음' 처럼 붙어 버린다. 기존 텍스트 경로처럼 공백으로 남아야 한다.
  it('keeps a soft line break after a chip as whitespace', () => {
    const out = docToMarkdown(markdownToDoc('<@5>\n다음 줄'))
    expect(out).not.toContain('<@5>다음')
    expect(out).toMatch(/^<@5>\s다음 줄$/)
  })

  // 파서 setup 은 parse() 때마다 같은 markdown-it 인스턴스에 호출된다 — 규칙이 누적 등록되면
  // 동기화 서버의 재사용 변환기가 파싱할수록 느려진다.
  it('registers the inline rule only once across parses', () => {
    const ed = new Editor({ extensions: wikiSchemaExtensions() })
    for (let i = 0; i < 3; i++) ed.commands.setContent('a <@1>', false)
    const storage = ed.storage as { markdown: { parser: { md: MarkdownIt } } }
    const rules = (storage.markdown.parser.md.inline.ruler as unknown as { __rules__: { name: string }[] }).__rules__
    expect(rules.filter((r) => r.name === 'wiki_mention')).toHaveLength(1)
    ed.destroy()
  })
})
