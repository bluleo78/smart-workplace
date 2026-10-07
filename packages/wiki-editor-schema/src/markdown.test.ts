import { describe, expect, it } from 'vitest'

import { docToMarkdown, markdownToDoc } from './markdown'

// 공용 변환기가 기존 웹 경로와 같은 마크다운을 내는지 — 서버 이관·파생 body 의 기준.
describe('markdown codec', () => {
  it('round-trips headings, lists, code and korean text', () => {
    const md = '# 회의록\n\n- 항목 1\n- 항목 2\n\n```ts\nconst a = 1\n```\n\n한글 문단입니다.'
    expect(docToMarkdown(markdownToDoc(md))).toBe(md)
  })

  it('is idempotent on second pass', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 \\| 3 |\n'
    const once = docToMarkdown(markdownToDoc(md))
    expect(docToMarkdown(markdownToDoc(once))).toBe(once)
  })

  it('normalizes image alt null and empty to the same node', () => {
    const a = markdownToDoc('![](/api/v1/wiki/attachments/1)')
    const b = markdownToDoc('<img src="/api/v1/wiki/attachments/1">')
    expect(a.firstChild?.firstChild?.attrs.alt).toBe('')
    expect(b.firstChild?.firstChild?.attrs.alt).toBe('')
  })
})
