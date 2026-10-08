import type { HocuspocusProvider } from '@hocuspocus/provider'
import { COLLAB_FRAGMENT, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import type { Extension, Extensions } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import type * as Y from 'yjs'

import { WikiAiMarkers } from './wikiAiMarkers'
import { WikiImage } from './wikiImageNode'
import { WikiMention } from './wikiMentionNode'
import { WikiUploadPlaceholder } from './wikiUploadPlaceholder'

/**
 * 노트 에디터가 실제로 쓰는 확장 목록(WP-313 에서 WikiEditor 에서 꺼냄) — 웹 스키마 지문 테스트가 같은 목록으로 스키마를 계산해
 * 패키지의 판별 지문(WIKI_SCHEMA_FINGERPRINTS)과 비교한다. 웹이 얹은 확장이 스키마를 바꾸면 판을 올리지 않은 채 배포되지 않게.
 * 화면 상태를 쥔 확장(멘션·슬래시·표 단축키)은 컴포넌트가 ref 와 함께 만들어 넘긴다.
 */
export function wikiEditorExtensions(o: {
  doc: Y.Doc
  awareness: HocuspocusProvider['awareness']
  mention: Extension
  slash: Extension
  tableShortcuts: Extension
}): Extensions {
  return [
    // 문서 스키마(텍스트·마크다운·멘션·이미지·표)는 동기화 서버와 공유하는 공용 묶음(WP-284).
    // 이미지·멘션은 웹 NodeView 를 붙인 버전을 주입한다 — 스키마 자체는 패키지와 동일.
    // 실행 취소는 Yjs 가 맡으므로(내 편집만 되돌림) 기본 history 는 끈다 — 켜 두면 남의 편집까지 되돌린다.
    ...wikiSchemaExtensions({ image: WikiImage, mention: WikiMention }),
    // 본문 실시간 동기화(WP-287) — 동기화 서버와 같은 조각 이름(COLLAB_FRAGMENT)을 쓴다. 본문은 서버 문서가 원본이라
    // content 로 초기화하지 않는다(넣으면 동기화 때 본문이 두 벌이 된다).
    Collaboration.configure({ document: o.doc, field: COLLAB_FRAGMENT }),
    o.mention,
    o.slash,
    Placeholder.configure({
      placeholder: "내용을 입력하거나 '/' 를 눌러 AI 사용",
      showOnlyCurrent: false,
    }),
    // 행·열 삽입 단축키(Ctrl-Alt-화살표). 표 밖이거나 뷰어 권한이면 false 를 반환해 기본 동작을 유지한다.
    o.tableShortcuts,
    // 이미지 업로드 자리표시자 — 공유 문서가 아니라 내 화면에만 그리는 데코레이션(WP-295).
    WikiUploadPlaceholder,
    // 다른 사람의 AI 가 쓰는 자리 ✦ 표식(WP-291) — awareness(서버·다른 접속자의 /ai)에서 읽어 내 화면에만 그린다.
    WikiAiMarkers.configure({ awareness: o.awareness }),
  ]
}
