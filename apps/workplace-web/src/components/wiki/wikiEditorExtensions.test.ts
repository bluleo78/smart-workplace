// @vitest-environment jsdom
// WP-313 — 웹 에디터가 실제로 쓰는 확장 목록(NodeView 를 얹은 WikiImage·WikiMention extend, 협업·제안·표식 확장 포함)의 스키마가
// 패키지에 기록된 현재 판 지문과 같아야 한다. 웹 쪽 확장이 노드·마크·attrs 를 바꾸면 판을 올리지 않은 채 배포돼, 판이 같은 다른
// 접속자(서버 코덱·다른 탭)와 스키마가 어긋나 모르는 서식 글자를 지우게 된다.
import { WIKI_SCHEMA_VERSION } from '@smart-workplace/wiki-editor-schema/collab-protocol'
import {
  schemaFingerprint,
  schemaShape,
  WIKI_SCHEMA_FINGERPRINTS,
} from '@smart-workplace/wiki-editor-schema/schema-fingerprint'
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { wikiEditorExtensions } from './wikiEditorExtensions'
import { createWikiMentionExtension } from './wikiMentionSuggestion'
import { createWikiSlashExtension } from './wikiSlashSuggestion'
import { createWikiTableShortcuts } from './wikiTableShortcuts'

describe('web editor schema', () => {
  it('matches the package fingerprint recorded for the current schema version', () => {
    // getSchema 는 플러그인을 만들지 않는다 — 제안·단축키 확장의 콜백 ref 는 호출되지 않으므로 빈 값으로 둔다.
    const canEditRef = { current: false }
    const schema = getSchema(
      wikiEditorExtensions({
        doc: new Y.Doc(),
        awareness: null,
        mention: createWikiMentionExtension({
          canEditRef,
          candidatesRef: { current: [] },
          onQueryChange: () => {},
          refresh: { current: () => {} },
        }),
        slash: createWikiSlashExtension({
          canEditRef,
          onActionRef: { current: () => {} },
          onImageInsertRef: { current: () => {} },
        }),
        tableShortcuts: createWikiTableShortcuts({ canEditRef }),
      }),
    )
    expect(
      schemaFingerprint(schema),
      `웹 에디터 스키마가 패키지 판 ${WIKI_SCHEMA_VERSION} 과 다릅니다. 웹 확장이 스키마를 바꿨다면 공용 패키지로 옮기고 판을 올리세요.\n웹 스키마:\n${schemaShape(schema)}`,
    ).toBe(WIKI_SCHEMA_FINGERPRINTS[WIKI_SCHEMA_VERSION])
  })
})
