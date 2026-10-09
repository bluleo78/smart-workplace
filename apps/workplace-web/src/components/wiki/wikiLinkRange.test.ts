// @vitest-environment jsdom
import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { linkAtCaret } from './wikiLinkRange'

const schema = getSchema(wikiSchemaExtensions())
const link = (href: string) => schema.marks.link.create({ href })

/** "ab[LINK]cd" 문단 — 링크 글자 위치: 문단 시작(1) 기준 a=1,b=2, LINK=3..7, c=7, d=8. */
function stateAt(pos: number, nodes = [schema.text('ab'), schema.text('LINK', [link('https://x.test')]), schema.text('cd')]) {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, nodes)])
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) })
}

describe('linkAtCaret — 커서가 링크 안일 때만 링크 범위(WP-312)', () => {
  it('링크 글자 사이면 링크 전체 범위와 주소', () => {
    expect(linkAtCaret(stateAt(5))).toEqual({ from: 3, to: 7, href: 'https://x.test' })
  })

  it('링크 바로 앞·바로 뒤 경계는 안이 아니다(새 링크 자리)', () => {
    expect(linkAtCaret(stateAt(3))).toBeNull()
    expect(linkAtCaret(stateAt(7))).toBeNull()
  })

  it('문단 맨 앞·맨 끝이 링크여도 경계는 안이 아니다', () => {
    const only = [schema.text('LINK', [link('https://x.test')])]
    expect(linkAtCaret(stateAt(1, only))).toBeNull()
    expect(linkAtCaret(stateAt(5, only))).toBeNull()
    expect(linkAtCaret(stateAt(3, only))).toEqual({ from: 1, to: 5, href: 'https://x.test' })
  })

  it('서로 다른 두 링크가 맞닿은 경계는 안이 아니다', () => {
    const two = [schema.text('AA', [link('https://a.test')]), schema.text('BB', [link('https://b.test')])]
    expect(linkAtCaret(stateAt(3, two))).toBeNull()
    expect(linkAtCaret(stateAt(2, two))).toEqual({ from: 1, to: 3, href: 'https://a.test' })
  })

  it('비어 있지 않은 선택은 대상이 아니다', () => {
    const s = stateAt(5)
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 4, 6)))
    expect(linkAtCaret(sel)).toBeNull()
  })
})
