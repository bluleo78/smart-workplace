import { Editor } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

import { wikiSchemaExtensions } from './extensions'

// 헤드리스 변환기 — 스키마·직렬화기만 쓰므로 하나를 재사용한다(Editor 생성 비용·메모리 절감).
// DOM 전역(window/document/DOMParser)이 먼저 설치돼 있어야 한다(서버는 happy-dom).
let converter: Editor | null = null
function getConverter(): Editor {
  converter ??= new Editor({ extensions: wikiSchemaExtensions() })
  return converter
}

/** 마크다운 → ProseMirror 문서(공용 스키마). */
export function markdownToDoc(md: string): PMNode {
  const ed = getConverter()
  ed.commands.setContent(md, false)
  return ed.state.doc
}

/** ProseMirror 문서 → 마크다운(tiptap-markdown 직렬화기). */
export function docToMarkdown(doc: PMNode): string {
  const storage = getConverter().storage as { markdown: { serializer: { serialize(d: PMNode): string } } }
  return storage.markdown.serializer.serialize(doc)
}

/** 공용 스키마 — y-prosemirror 변환에 쓴다. */
export function getMarkdownSchema(): Schema {
  return getConverter().schema
}
