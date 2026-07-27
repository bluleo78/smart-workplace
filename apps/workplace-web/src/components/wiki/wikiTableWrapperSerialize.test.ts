// @vitest-environment jsdom
//
// #754 부수효과 고정 — renderWrapper:true 를 켜면 Table 의 renderHTML 이 div.tableWrapper 를
// 함께 내보내므로, GFM 으로 표현 못 하는 표(병합 셀 등)의 raw HTML 폴백 저장본에 래퍼 div 가
// 섞인다. 우리 UI 는 병합 셀을 만들 수 없어 이 경로는 외부 입력(AI·MCP 가 쓴 본문)에서만 생기며,
// 저장 → 재로드 → 재저장이 안정적인 한 허용한다. 그 안정성이 이 테스트의 요점이다.
import { Editor } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { describe, expect, it } from 'vitest'

import { WikiMarkdownText } from './wikiMarkdownText'

function roundtrip(content: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ text: false }),
      WikiMarkdownText,
      Markdown,
      Table.configure({ resizable: false, renderWrapper: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
  })
  const out = editor.storage.markdown.getMarkdown()
  editor.destroy()
  return out
}

describe('표 래퍼 직렬화 (#754)', () => {
  it('GFM 으로 표현 가능한 표는 래퍼 없이 순수 GFM 으로 저장된다', () => {
    const md = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const out = roundtrip(md)
    expect(out).not.toContain('tableWrapper')
    expect(out).not.toContain('<table')
  })

  it('병합 셀 표(raw HTML 폴백)는 재저장해도 열화하지 않는다', () => {
    const html =
      '<table><tbody><tr><td colspan="2">병합</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>'
    const once = roundtrip(html)
    expect(once).toContain('colspan="2"')
    expect(roundtrip(once)).toBe(once)
  })
})
