import { createDocument, Editor } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

import { wikiSchemaExtensions } from './extensions'

// 헤드리스 변환기 — 스키마·직렬화기만 쓰므로 하나를 재사용한다(Editor 생성 비용·메모리 절감).
// DOM 전역(window/document/DOMParser)이 먼저 설치돼 있어야 한다(서버는 happy-dom).
let converter: Editor | null = null
function getConverter(): Editor {
  converter ??= new Editor({ extensions: wikiSchemaExtensions() })
  return converter
}

/**
 * 마크다운 → ProseMirror 문서(공용 스키마).
 * `setContent` 명령(tiptap-markdown 이 마크다운 → HTML 로 바꿔 tiptap 기본 setContent 에 넘김)과 같은 결과를 만들되,
 * 거래를 편집기 화면(view)에 보내지 않고 상태 계산만 한다(WP-1284) — 보내면 숨은 변환기 화면이 문서 전체를 DOM 으로 다시 그리고,
 * ProseMirror 가 그 변경을 정리하는 20ms 타이머를 건다. 변환기는 내리지 않는 싱글턴이라 그 타이머가 테스트 환경이 내려간 뒤
 * 터져 「document is not defined」로 push 게이트를 깨뜨렸다(workplace-web 의 jsdom 테스트 wikiHtmlEmbedFrame.test.ts — 이 패키지·서버의
 * happy-dom 은 그 DOM 변경을 기록하지 않아 재현되지 않았다). 화면을 다시 그리지 않으니 큰 문서 변환도 가벼워진다.
 */
export function markdownToDoc(md: string): PMNode {
  const ed = getConverter()
  const storage = ed.storage as { markdown: { parser: { parse(content: string): string } } }
  const doc = createDocument(storage.markdown.parser.parse(md), ed.schema, {}, { errorOnInvalidContent: ed.options.enableContentCheck })
  // tiptap setContent 와 같은 바꾸기를 상태에만 적용한다 — apply 는 플러그인의 appendTransaction(표 고치기 등)까지 돌려
  // 화면에 보냈을 때와 같은 문서가 된다. 변환기 상태는 바꾸지 않는다(매번 빈 문서에서 시작).
  return ed.state.apply(ed.state.tr.replaceWith(0, ed.state.doc.content.size, doc)).doc
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
