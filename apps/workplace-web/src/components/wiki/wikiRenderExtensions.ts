import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import type { AnyExtension, Extensions } from '@tiptap/core'

import { WikiHtmlScope } from './wikiHtmlScope'
import { WikiPasteShape } from './wikiPasteShape'
import { WikiStyle } from './wikiStyleNode'

/**
 * 노트 본문을 그리는 화면(편집기·판 미리보기·공개 공유)이 함께 쓰는 확장 묶음(WP-1240).
 * 공용 문서 스키마에 페이지 스타일 칩(WikiStyle)을 얹고, HTML 모양 범위 가두기(WikiHtmlScope)를 붙인다 — 화면마다 손으로 엮다
 * 하나를 빠뜨리면 그 화면에서만 노트 CSS 가 적용되지 않거나 앱 화면으로 샌다.
 * 공개 공유 화면도 쓰므로 동기화·로그인 API 를 부르는 확장은 넣지 않는다(각 화면이 제 확장을 뒤에 더한다).
 */
export function wikiRenderExtensions(
  opts: {
    /** 이미지·멘션 — 웹 NodeView 를 붙인 버전. 안 주면 공용 스키마 기본 노드(로그인 API 를 부르지 않는다). */
    image?: AnyExtension
    mention?: AnyExtension
    /** 붙여넣기 모양 거르기·노트 복사 표지(WikiPasteShape)를 넣을지 — 복사·붙여넣기가 있는 화면(편집기·판 미리보기)만. */
    pasteShape?: boolean
  } = {},
): Extensions {
  const { pasteShape, ...schemaOpts } = opts
  return [
    ...wikiSchemaExtensions({ style: WikiStyle, ...schemaOpts }),
    // 페이지 스타일 CSS 를 이 본문에 가둬 주입하고, 모양이 있으면 본문을 contain 으로 가둔다.
    WikiHtmlScope,
    // 노트 밖에서 온 HTML·글자 붙여넣기는 모양 노드를 만들지 않고, 노트끼리 복사만 모양을 옮긴다.
    ...(pasteShape ? [WikiPasteShape] : []),
  ]
}
