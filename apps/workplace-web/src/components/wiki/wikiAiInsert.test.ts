// @vitest-environment jsdom
//
// 노트 AI 결과 1회 삽입(WP-255) — 블록 결과의 목록 줄바꿈 잔재 제거와, 문장 중간 인라인 결과의 앞뒤 공백 보존을 고정한다.
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { describe, expect, it } from 'vitest'

import { insertAiMarkdown } from './wikiAiInsert'

/** doc 을 로드하고 범위(기본: 마지막 문단 끝)에 결과를 삽입한 뒤 마크다운으로 직렬화한다. */
function insert(doc: string, markdown: string, range?: { from: number; to: number }): string {
  const editor = new Editor({ extensions: [StarterKit, Markdown], content: doc })
  const end = editor.state.doc.content.size - 1
  insertAiMarkdown(editor, range?.from ?? end, range?.to ?? end, markdown)
  const out = editor.storage.markdown.getMarkdown()
  editor.destroy()
  return out
}

describe('insertAiMarkdown', () => {
  it('하위 목록 위에 빈 줄이 남지 않는다', () => {
    expect(insert('', '- a\n  - b\n- c', { from: 1, to: 1 })).toBe('- a\n  - b\n- c')
  })

  it('이어쓰기 — 서식이 섞인 한 줄 결과의 앞 공백이 보존된다', () => {
    expect(insert('문장 끝', ' 이어서 **굵게** 쓴다')).toBe('문장 끝 이어서 **굵게** 쓴다')
  })

  it('문장 중간 삽입 — 서식이 섞인 한 줄 결과의 뒤 공백이 보존된다', () => {
    expect(insert('앞뒤', '**삽입** ', { from: 2, to: 2 })).toBe('앞**삽입** 뒤')
  })

  it('이어쓰기 — 여러 줄 결과의 앞 공백이 보존되고 이후는 블록으로 들어간다', () => {
    expect(insert('문장 끝', ' 이어서 **문장**.\n\n- a\n  - b')).toBe('문장 끝 이어서 **문장**.\n\n- a\n  - b')
  })

  it('선택 범위 변형 — 결과로 범위를 교체한다', () => {
    expect(insert('hello world foo', '**WORLD**', { from: 7, to: 12 })).toBe('hello **WORLD** foo')
  })

  it('범위가 문서 끝을 넘어도 클램프해 삽입한다', () => {
    expect(insert('짧음', '\n\n추가 문단', { from: 999, to: 999 })).toBe('짧음\n\n추가 문단')
  })
})
