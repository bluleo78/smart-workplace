// @vitest-environment jsdom
//
// #750 회귀 — 노트 본문의 이미지 마크다운이 로드→저장 라운드트립에서 소실되지 않는지 고정한다.
// 원인: 스키마에 image 노드가 없으면 markdown-it 이 파싱한 이미지를 ProseMirror 가 통째로 버리고,
// WikiEditor 가 getMarkdown() 결과를 그대로 저장해 이미지가 영구 삭제된다(alt 조차 남지 않음).
// inline:true 가 아니면 URL 은 살아나도 문단 구조가 깨진다(빈 줄 소실).
import { Editor } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { describe, expect, it } from 'vitest'

import { WikiImage } from './wikiImageNode'

/** WikiEditor 와 동일한 직렬화 경로로 마크다운을 왕복시킨다. */
function roundtrip(markdown: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Markdown,
      WikiImage,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: markdown,
  })
  const out = editor.storage.markdown.getMarkdown()
  editor.destroy()
  return out
}

describe('노트 이미지 마크다운 라운드트립 (#750)', () => {
  it('블록 이미지가 문단 구조까지 보존된다', () => {
    const md = '# 제목\n\n![대체텍스트](/api/v1/wiki/attachments/7/content)\n\n본문'
    expect(roundtrip(md)).toBe(md)
  })

  it('문단 안 인라인 이미지가 문단을 쪼개지 않는다', () => {
    const md = '문단 안 이미지 ![i](/z.png) 뒤 텍스트'
    expect(roundtrip(md)).toBe(md)
  })

  it('쿼리스트링이 보존된다', () => {
    const md = '![a](/x?y=1)'
    expect(roundtrip(md)).toBe(md)
  })

  it('title 속성이 보존된다', () => {
    const md = '![a](/x "제목")'
    expect(roundtrip(md)).toBe(md)
  })

  it('재라운드트립이 안정적이다 (반복 저장으로 열화하지 않음)', () => {
    const md = '# 제목\n\n![대체텍스트](/api/v1/wiki/attachments/7/content)\n\n본문'
    expect(roundtrip(roundtrip(md))).toBe(md)
  })

  // 첨부 API 경로는 저장-로드 왕복에서 문자 하나도 변하면 안 된다.
  // 백엔드 promote 파서(WikiAttachmentService.ATTACHMENT_URL)가 이 형태만 인식하므로,
  // 퍼센트 인코딩 등으로 형태가 바뀌면 업로드는 성공하는데 몇 시간 뒤 blob 이 만료 수거된다.
  it('첨부 API 경로가 라운드트립에서 그대로 유지된다', () => {
    const md = '![스크린샷](/api/v1/wiki/pages/12/attachments/34/content)'
    expect(roundtrip(md)).toBe(md)
  })
})
