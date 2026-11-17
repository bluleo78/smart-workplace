// 본문 모드 RichInput 붙여넣기·복사 변환(WP-1656) — 이슈 본문 원문을 Textarea 처럼 줄 단위 그대로 주고받는다.
// ProseMirror 기본 처리는 붙여넣을 때 연속 줄바꿈을 하나로 합치고(prosemirror-view 의 text.split(/(?:\r\n?|\n)+/)),
// 복사할 때 문단 사이를 빈 줄("\n\n")로 내보내 원문 줄 간격이 바뀐다. 본문 모드는 이 둘을 아래 함수로 바꾼다.
// 문서 ↔ 원문 규칙은 열고 저장할 때와 같은 bodyToDoc / serializeToBody 를 그대로 쓴다(한 줄 = 한 문단).
import type { JSONContent } from '@tiptap/core'
import { Node as PMNode, type Schema, Slice } from '@tiptap/pm/model'

import { bodyToDoc, serializeToBody } from './mentionSerialize'
import type { MentionUser } from './types'

/**
 * 클립보드 일반 글자 → 붙여넣을 조각. 줄바꿈(\r\n·\r·\n) 하나마다 문단 하나(빈 줄은 빈 문단)이고, 이 프로젝트 이미지 마크다운·<@id> 는
 * 열 때와 같이 노드로 읽는다. 열린 조각(openStart=1, openEnd=1)이라 첫 줄은 커서 앞 글자에, 마지막 줄은 커서 뒤 글자에 이어진다.
 * \r\n·\r 은 \n 으로 바뀐다 — Textarea 붙여넣기와 같다(줄 나누기는 bodyToDoc 본문 모드가 \r\n·\r·\n 모두로 한다).
 */
export function bodyTextToSlice(text: string, schema: Schema, opts: { mentions: MentionUser[]; projectKey: string }): Slice {
  // 본문 모드 스키마에는 늘 이미지 노드가 있다(RichInput 이 본문 모드면 이미지 확장을 켠다).
  const doc = bodyToDoc(text, opts.mentions, { images: true, imageProjectKey: opts.projectKey })
  return new Slice(PMNode.fromJSON(schema, doc).content, 1, 1)
}

/**
 * 복사·잘라내기 조각 → 클립보드 일반 글자. 문단 사이 줄바꿈 하나, 멘션 `<@id>`, src 있는 이미지 `![alt](src)`, hardBreak `\n` —
 * 저장할 때(serializeToBody)와 같은 규칙이라 메모장에 붙여도 원문과 줄 간격이 같다.
 * 한 문단 안에서 고른 조각은 문단 없이 인라인 노드만 담기므로(문단 깊이에서 자른 조각) 한 문단으로 감싸 같은 규칙을 쓴다.
 */
export function sliceToBodyText(slice: Slice): string {
  const nodes = (slice.content.toJSON() ?? []) as JSONContent[]
  const blocks = slice.content.firstChild?.isBlock ? nodes : [{ type: 'paragraph', content: nodes }]
  return serializeToBody({ type: 'doc', content: blocks })
}
