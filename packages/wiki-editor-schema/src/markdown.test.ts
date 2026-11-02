import { Editor } from '@tiptap/core'
import { EditorView } from '@tiptap/pm/view'
import { describe, expect, it, vi } from 'vitest'

import { wikiSchemaExtensions } from './extensions'
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

// WP-1284: 변환은 숨은 변환기 화면을 다시 그리지 않는다 — 그리면 ProseMirror 가 DOM 변경 정리 타이머(20ms)를 걸고,
// 내리지 않는 싱글턴 변환기의 그 타이머가 테스트 환경이 내려간 뒤 터져 「document is not defined」 처리 안 된 오류가 났다.
describe('markdownToDoc 은 화면을 건드리지 않는다', () => {
  it('변환할 때 편집기 화면을 갱신하지 않는다(내용이 바뀌는 연속 변환 포함)', () => {
    markdownToDoc('준비 — 변환기 생성')
    const spy = vi.spyOn(EditorView.prototype, 'updateState')
    try {
      for (const md of ['# 제목\n\n본문 문단', '- 항목 1\n- 항목 2', '| a | b |\n| --- | --- |\n| 1 | 2 |', '']) markdownToDoc(md)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('편집기 setContent 와 같은 문서를 만든다 — 표(정렬·고치기)·HTML 블록·빈 글 포함', () => {
    const samples = [
      '',
      '첫 문단\n\n둘째 문단',
      '| 왼쪽 | 가운데 | 오른쪽 |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 |',
      '```html-embed\n<b>x</b>\n```',
      '<div class="card">\n\n본문\n\n</div>',
    ]
    // 화면에 보내는 예전 경로(setContent)를 새 편집기로 돌려 결과를 비교한다 — tiptap·tiptap-markdown 이 바뀌어 두 길이 어긋나면 잡는다.
    const ref = new Editor({ extensions: wikiSchemaExtensions() })
    try {
      for (const md of samples) {
        ref.commands.setContent(md, false)
        expect(markdownToDoc(md).toJSON()).toEqual(ref.state.doc.toJSON())
      }
    } finally {
      ref.destroy()
    }
  })
})
