// @vitest-environment jsdom
//
// #755 회귀 — 표 셀 안의 파이프(|)가 저장 시 셀 구분자로 새어 셀이 쪼개지는 문제를 고정한다.
// prosemirror-markdown 의 esc 는 ` * \ ~ [ ] _ 만 다루고 |는 손대지 않으며, tiptap-markdown 의
// 표 직렬화기도 별도 처리가 없다. raw HTML 로 새는 것이 아니라 조용히 셀 개수가 바뀌는
// 무음 데이터 변형이라 사용자가 눈치채기 어렵다.
import { Editor } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { describe, expect, it } from 'vitest'

import { WikiImage } from './wikiImageNode'
import { WikiMarkdownText } from './wikiMarkdownText'

/** WikiEditor 와 동일한 확장 구성으로 에디터를 만든다. */
function createEditor(content: unknown): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ text: false }),
      WikiMarkdownText,
      Markdown,
      WikiImage,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: content as string,
  })
}

/** WikiEditor 와 동일한 직렬화 경로로 마크다운을 왕복시킨다. */
function roundtrip(markdown: string): string {
  const editor = createEditor(markdown)
  const out = editor.storage.markdown.getMarkdown()
  editor.destroy()
  return out
}

/** 파이프로 시작하는 줄만 뽑는다(표 본문). */
function tableLines(md: string): string[] {
  return md.split('\n').filter((l) => l.trim().startsWith('|'))
}

describe('표 셀 파이프 이스케이프 (#755)', () => {
  it('셀 안의 |가 이스케이프되어 셀이 쪼개지지 않는다', () => {
    const md = ['| 항목 | 값 |', '| --- | --- |', '| 조건 | a\\|b |'].join('\n')
    const out = roundtrip(md)

    expect(tableLines(out)).toEqual(['| 항목 | 값 |', '| --- | --- |', '| 조건 | a\\|b |'])
    // 재라운드트립해도 백슬래시가 늘어나지 않는다(중복 이스케이프 회귀).
    expect(roundtrip(out)).toBe(out)
  })

  it('헤더 셀의 |도 이스케이프된다', () => {
    const md = ['| a\\|b | 값 |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    expect(tableLines(roundtrip(md))).toEqual(['| a\\|b | 값 |', '| --- | --- |', '| 1 | 2 |'])
  })

  it('표 밖의 |는 이스케이프하지 않는다 — 저장본 가독성을 지킨다', () => {
    expect(roundtrip('a | b')).toBe('a | b')
  })

  it('셀 안의 기존 이스케이프 대상(백슬래시·별표)은 그대로 동작한다', () => {
    const md = ['| a | b |', '| --- | --- |', '| \\*강조아님\\* | \\\\ |'].join('\n')
    const out = roundtrip(md)
    expect(tableLines(out)).toEqual(['| a | b |', '| --- | --- |', '| \\*강조아님\\* | \\\\ |'])
  })

  it('기본 Text 직렬화기의 <,> 처리(escapeHTML)를 그대로 유지한다', () => {
    // Text 직렬화기를 통째로 갈아끼우므로 기존 동작이 함께 사라지지 않는지 고정한다.
    // 마크다운 문자열로 넣으면 markdown-it 이 <b> 를 인라인 HTML 로 먼저 먹으므로 문서 JSON 으로 넣는다.
    const editor = createEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a<b' }] }] })
    const out = editor.storage.markdown.getMarkdown()
    editor.destroy()
    expect(out).toBe('a&lt;b')
  })
})
