// WP-313 — 스키마 판 가드. 공용 스키마(노드·마크 이름, attrs 와 기본값, content·marks 규칙)가 바뀌었는데 WIKI_SCHEMA_VERSION 을
// 올리지 않으면 실패한다. 판을 안 올리면 배포 전 탭이 새 스키마 문서에 붙어, 모르는 서식 글자를 지우고 그 삭제를 퍼뜨린다.
// 웹이 실제로 쓰는 확장 목록(NodeView extend 포함)은 웹의 wikiEditorExtensions.test.ts 가 같은 기록과 비교한다.
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { wikiSchemaExtensions } from './extensions'
import { WikiImageSchema } from './imageNode'
import { schemaFingerprint, schemaShape, WIKI_SCHEMA_FINGERPRINTS } from './schemaFingerprint'
import { WIKI_SCHEMA_VERSION } from './schemaVersion'

describe('WIKI_SCHEMA_VERSION guard', () => {
  const schema = getSchema(wikiSchemaExtensions())
  const current = schemaFingerprint(schema)

  it('matches the recorded fingerprint of the current schema version', () => {
    expect(
      WIKI_SCHEMA_FINGERPRINTS[WIKI_SCHEMA_VERSION],
      `스키마가 바뀌었다면 WIKI_SCHEMA_VERSION 을 올리고 WIKI_SCHEMA_FINGERPRINTS 에 { ${WIKI_SCHEMA_VERSION + 1}: '${current}' } 를 추가하세요.\n현재 스키마:\n${schemaShape(schema)}`,
    ).toBe(current)
  })

  it('records the current version as the newest and never reuses a fingerprint', () => {
    expect(Math.max(...Object.keys(WIKI_SCHEMA_FINGERPRINTS).map(Number))).toBe(WIKI_SCHEMA_VERSION)
    expect(new Set(Object.values(WIKI_SCHEMA_FINGERPRINTS)).size).toBe(Object.keys(WIKI_SCHEMA_FINGERPRINTS).length)
  })

  it('includes the link mark (version 1 ships with links, WP-300)', () => {
    expect(schemaShape(schema)).toContain('mark link ')
  })

  // 기본값만 바뀌어도 지문이 달라져야 한다 — 옛 탭은 같은 노드의 빠진 attrs 를 다른 값으로 채운다.
  it('changes when only an attribute default changes', () => {
    const changed = WikiImageSchema.extend({
      addAttributes() {
        return { ...this.parent?.(), alt: { default: '대체 글자' } }
      },
    })
    const fp = schemaFingerprint(getSchema(wikiSchemaExtensions({ image: changed })))
    expect(fp).not.toBe(current)
    expect(fp).not.toBe(WIKI_SCHEMA_FINGERPRINTS[WIKI_SCHEMA_VERSION])
  })

  it('changes when an attribute is added', () => {
    const added = WikiImageSchema.extend({
      addAttributes() {
        return { ...this.parent?.(), width: { default: null } }
      },
    })
    expect(schemaFingerprint(getSchema(wikiSchemaExtensions({ image: added })))).not.toBe(current)
  })
})
