// @vitest-environment jsdom
import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { startUploadPlaceholder, UPLOAD_PLACEHOLDER_TEXT, WikiUploadPlaceholder } from './wikiUploadPlaceholder'

// 이미지 업로드 자리표시자(WP-295) — 실제 y-prosemirror 로 두 편집자를 이어, 자리표시자가 공유 문서에 들어가지 않고
// 다른 사람의 편집을 따라가는지 브라우저 없이 확인한다.

/** 두 Y.Doc 을 서로 동기화한다(동기화 서버 대신). */
function link(a: Y.Doc, b: Y.Doc) {
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== b && Y.applyUpdate(b, u, a))
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== a && Y.applyUpdate(a, u, b))
}

const editors: Editor[] = []
function makeEditor(doc: Y.Doc): Editor {
  const editor = new Editor({
    extensions: [
      ...wikiSchemaExtensions(),
      Collaboration.configure({ document: doc, field: 'default' }),
      WikiUploadPlaceholder,
    ],
  })
  editors.push(editor)
  return editor
}

/** 문서에서 글자 text 가 끝나는 위치. */
function endOf(view: EditorView, text: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return
    const idx = node.text!.indexOf(text)
    if (idx >= 0) found = pos + idx + text.length
  })
  if (found < 0) throw new Error(`no "${text}"`)
  return found
}

/** 화면에 그려진 자리표시자 수. */
const placeholderCount = (view: EditorView) => view.dom.querySelectorAll('[data-testid="wiki-upload-placeholder"]').length

/** 공유 문서(Yjs)의 내용 — 다른 사람·동기화 서버가 보는 것. */
const sharedText = (doc: Y.Doc) => doc.getXmlFragment('default').toString()

describe('wikiUploadPlaceholder', () => {
  afterEach(() => {
    editors.splice(0).forEach((e) => {
      if (!e.isDestroyed) e.destroy()
    })
  })

  function setup() {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    link(docA, docB)
    const a = makeEditor(docA)
    const b = makeEditor(docB)
    b.commands.setContent('<p>첫 문단</p><p>둘째 문단</p>')
    return { a, b, docA, docB }
  }

  it('자리표시자는 내 화면에만 그려지고 공유 문서에는 들어가지 않는다', () => {
    const { a, b, docA, docB } = setup()
    startUploadPlaceholder(a.view, endOf(a.view, '둘째 문단'))
    expect(placeholderCount(a.view)).toBe(1)
    expect(a.view.dom.textContent).toContain(UPLOAD_PLACEHOLDER_TEXT)
    expect(placeholderCount(b.view)).toBe(0)
    for (const d of [docA, docB]) expect(sharedText(d)).not.toContain('업로드 중')
    expect(a.getText()).not.toContain('업로드 중')
  })

  it('다른 사람이 위쪽을 고쳐도 자리표시자가 남고 같은 자리(둘째 문단 끝)를 따라간다', () => {
    const { a, b } = setup()
    const spot = startUploadPlaceholder(a.view, endOf(a.view, '둘째 문단'))
    // 원격 변경은 y-prosemirror 가 문서 전체를 바꾸는 트랜잭션으로 반영한다 — 매핑만으로는 자리가 무너진다.
    b.commands.insertContentAt(1, '위에 끼운 글 ')
    expect(a.getText()).toContain('위에 끼운 글 첫 문단')
    expect(placeholderCount(a.view)).toBe(1)
    expect(spot.position(a.view)).toBe(endOf(a.view, '둘째 문단'))
  })

  it('업로드 중 그 자리에 친 내 글자는 자리표시자 뒤에 남고, 원격 변경 뒤에도 같은 자리다', () => {
    const { a, b } = setup()
    const at = endOf(a.view, '둘째 문단')
    const spot = startUploadPlaceholder(a.view, at)
    a.view.dispatch(a.view.state.tr.insertText('계속 입력', at))
    expect(spot.position(a.view)).toBe(at)
    b.commands.insertContentAt(1, '원격 ')
    expect(spot.position(a.view)).toBe(endOf(a.view, '둘째 문단'))
  })

  it('완료되면 따라간 자리에 이미지를 일반 편집으로 넣고 자리표시자를 걷는다 — 상대에게도 이미지만 간다', () => {
    const { a, b, docB } = setup()
    const spot = startUploadPlaceholder(a.view, endOf(a.view, '둘째 문단'))
    b.commands.insertContentAt(1, '위 ')
    const pos = spot.position(a.view)!
    a.view.dispatch(spot.removeIn(a.view.state.tr).insert(pos, a.view.state.schema.nodes.image.create({ src: '/img.png', alt: 'x' })))
    expect(placeholderCount(a.view)).toBe(0)
    const md = (b.storage.markdown as { getMarkdown: () => string }).getMarkdown()
    expect(md).toContain('둘째 문단![x](/img.png)')
    expect(sharedText(docB)).not.toContain('업로드 중')
  })

  it('두 사람이 동시에 올려도 업로드마다 고유한 자리라 서로의 이미지가 뒤바뀌지 않는다', () => {
    const { a, b } = setup()
    const spotA = startUploadPlaceholder(a.view, endOf(a.view, '첫 문단'))
    const spotB = startUploadPlaceholder(b.view, endOf(b.view, '둘째 문단'))
    // B 가 먼저 끝난다.
    b.view.dispatch(spotB.removeIn(b.view.state.tr).insert(spotB.position(b.view)!, b.view.state.schema.nodes.image.create({ src: '/b.png', alt: 'b' })))
    a.view.dispatch(spotA.removeIn(a.view.state.tr).insert(spotA.position(a.view)!, a.view.state.schema.nodes.image.create({ src: '/a.png', alt: 'a' })))
    const md = (a.storage.markdown as { getMarkdown: () => string }).getMarkdown()
    expect(md).toContain('첫 문단![a](/a.png)')
    expect(md).toContain('둘째 문단![b](/b.png)')
    expect(placeholderCount(a.view) + placeholderCount(b.view)).toBe(0)
  })

  // 업로드 중 에디터가 재마운트(lg 경계 셸 전환)되면 새 뷰엔 이 자리 상태가 없다 — 같은 Y.Doc 의 상대 위치로 자리를 푼다.
  it('업로드 중 에디터가 다시 만들어져도 새 에디터에서 같은 자리를 찾는다', () => {
    const { a, b, docA } = setup()
    const spot = startUploadPlaceholder(a.view, endOf(a.view, '첫 문단'))
    a.destroy()
    b.commands.insertContentAt(1, '그사이 원격 ')
    const a2 = makeEditor(docA)
    expect(a2.getText()).toContain('그사이 원격 첫 문단')
    expect(spot.position(a2.view)).toBe(endOf(a2.view, '첫 문단'))
  })

  it('실패하면 자리표시자만 걷고 문서는 그대로다', () => {
    const { a } = setup()
    const before = a.getJSON()
    const spot = startUploadPlaceholder(a.view, endOf(a.view, '첫 문단'))
    spot.remove(a.view)
    expect(placeholderCount(a.view)).toBe(0)
    expect(a.getJSON()).toEqual(before)
  })
})
