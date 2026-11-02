// @vitest-environment jsdom
// WP-1306 — 붙여넣기 칩 상태(wikiPasteChipPlugin): 노트 밖 HTML 을 붙이면 칩이 뜨고, 「글만」은 붙인 범위만 거른 결과로 바꾸며(한 단계),
// 「모양 유지」는 그 단계를 되돌리고, 입력·선택 이동·Esc·밖 누르기·내 실행 취소에 닫힌다. 노트 본문 편집기처럼 Yjs 동기화(Collaboration)를 단
// 편집기에서 본다 — 실행 취소가 Yjs UndoManager 라 ⌘Z 한 번에 붙여넣기가 사라지는지도 여기서 본다.
import { COLLAB_FRAGMENT, docToMarkdown, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { Slice } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { undo as yUndo } from 'y-prosemirror'
import * as Y from 'yjs'

import { WikiHtmlImportPaste } from './wikiHtmlImportInsert'
import { WikiHtmlScope } from './wikiHtmlScope'
import { changedRange, choosePastePlain, choosePasteShape, pasteChipState,pastedRangeToPlain } from './wikiPasteChipPlugin'
import { NOTE_COPY_ATTR, WikiPasteShape } from './wikiPasteShape'

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  document.body.innerHTML = ''
})

/** 동기화를 단 노트 편집기 — 본문은 Y 문서가 원본이라 setContent 로 채운다. */
function mount(markdown = '앞 글'): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [
      ...wikiSchemaExtensions(),
      WikiHtmlScope,
      WikiPasteShape,
      Collaboration.configure({ document: new Y.Doc(), field: COLLAB_FRAGMENT }),
      WikiHtmlImportPaste,
    ],
  })
  editors.push(editor)
  editor.commands.setContent(markdown)
  // 커서를 문서 끝으로.
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
  return editor
}

const pasteEvent = () => new Event('paste') as unknown as ClipboardEvent

/** 상대 위치를 적는 마이크로태스크·Yjs 반영을 기다린다. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

const CARD =
  '<div class="card" style="background-color: rgb(239, 246, 255); border: 1px solid rgb(191, 219, 254); padding: 16px"><p>카드 <span style="color: rgb(220, 38, 38)">빨강</span></p></div><p style="text-align:center">가운데</p>'

describe('paste chip state', () => {
  it('a foreign HTML paste with shape opens the chip on the pasted range, choice 「모양 유지」', async () => {
    const ed = mount()
    ed.view.pasteHTML(CARD, pasteEvent())
    const st = pasteChipState(ed.state)
    expect(st).toMatchObject({ choice: 'shape' })
    // 범위가 붙인 내용(상자·가운데 문단)을 덮고, 앞에 있던 글은 범위 밖이다.
    const text = ed.state.doc.textBetween(st!.from, st!.to, '\n')
    expect(text).toContain('카드 빨강')
    expect(text).toContain('가운데')
    expect(text).not.toContain('앞 글')
    await settle()
  })

  it('no chip when the text-only result is the same, for a note-to-note copy, or for a plain-text paste', () => {
    const ed = mount()
    ed.view.pasteHTML('<p style="font-family: Arial; color: #000">그냥 글</p>', pasteEvent())
    expect(pasteChipState(ed.state)).toBeNull()
    ed.view.pasteHTML(`<div ${NOTE_COPY_ATTR}="" style="background: #eff6ff"><p>노트</p></div>`, pasteEvent())
    expect(pasteChipState(ed.state)).toBeNull()
    ed.view.pasteText('<div style="background: #eff6ff">\n\n글자\n\n</div>', pasteEvent())
    expect(pasteChipState(ed.state)).toBeNull()
  })

  it('an HTML document source paste (WP-1241 path) is imported with its shape and opens no chip', () => {
    const ed = mount()
    const doc = '<!doctype html><html><head><style>.c{background:#eff6ff}</style></head><body><div class="c"><p>문서</p></div></body></html>'
    const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? doc : type === 'text/html' ? `<pre>${doc}</pre>` : '') },
    })
    ed.view.dom.dispatchEvent(event)
    expect(docToMarkdown(ed.state.doc)).toContain('<style data-wp-style>')
    expect(pasteChipState(ed.state)).toBeNull()
  })

  it('typing, moving the selection or Esc closes the chip; a meta-only transaction keeps it', async () => {
    const ed = mount()
    ed.view.pasteHTML(CARD, pasteEvent())
    ed.view.dispatch(ed.state.tr.setMeta('anything', true))
    expect(pasteChipState(ed.state)).not.toBeNull()
    ed.commands.insertContent('x')
    expect(pasteChipState(ed.state)).toBeNull()

    ed.view.pasteHTML(CARD, pasteEvent())
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atStart(ed.state.doc)))
    expect(pasteChipState(ed.state)).toBeNull()

    ed.view.pasteHTML(CARD, pasteEvent())
    ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(pasteChipState(ed.state)).toBeNull()
    await settle()
  })

  it('pressing outside the editor closes the chip; pressing on the chip does not', async () => {
    const ed = mount()
    const chip = document.createElement('div')
    chip.dataset.testid = 'wiki-paste-chip'
    const outside = document.createElement('button')
    document.body.append(chip, outside)
    ed.view.pasteHTML(CARD, pasteEvent())
    chip.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(pasteChipState(ed.state)).not.toBeNull()
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(pasteChipState(ed.state)).toBeNull()
    await settle()
  })

  it('「글만」 turns only the pasted range into the text-only result; 「모양 유지」 brings the shape back', async () => {
    const ed = mount('<div style="border: 1px solid red">\n\n원래 상자\n\n</div>\n\n앞 <span style="color: blue">원래 색</span>')
    // 새 빈 줄에 붙인다 — 글 중간에 붙이면 ProseMirror 가 첫 블록을 그 문단에 이어 붙여 상자 껍데기가 빠진다(노트끼리 복사도 같다).
    ed.commands.splitBlock()
    ed.view.pasteHTML(CARD, pasteEvent())
    await settle()
    const shaped = docToMarkdown(ed.state.doc)
    expect(shaped).toContain('<div style="background-color: rgb(239, 246, 255)')

    expect(choosePastePlain(ed)).toBe(true)
    expect(pasteChipState(ed.state)?.choice).toBe('plain')
    const plain = docToMarkdown(ed.state.doc)
    // 붙인 상자·색·정렬은 빠지고, 원래 있던 상자·색 글자는 그대로다.
    expect(plain).not.toContain('rgb(239, 246, 255)')
    expect(plain).not.toContain('rgb(220, 38, 38)')
    expect(plain).not.toContain('<div align="center">')
    expect(plain).toContain('카드 빨강')
    expect(plain).toContain('<div style="border: 1px solid red">')
    expect(plain).toContain('<span style="color: blue">원래 색</span>')
    await settle()

    expect(choosePasteShape(ed)).toBe(true)
    expect(pasteChipState(ed.state)?.choice).toBe('shape')
    expect(docToMarkdown(ed.state.doc)).toBe(shaped)
    await settle()
  })

  it('one undo removes the whole paste (separate from earlier typing) and closes the chip', async () => {
    const ed = mount()
    await settle()
    ed.commands.insertContent(' 이어 친 글')
    await settle()
    const before = docToMarkdown(ed.state.doc)
    ed.view.pasteHTML(CARD, pasteEvent())
    await settle()
    expect(pasteChipState(ed.state)).not.toBeNull()
    expect(yUndo(ed.state)).toBe(true)
    expect(docToMarkdown(ed.state.doc)).toBe(before)
    expect(pasteChipState(ed.state)).toBeNull()
  })

  it('a peer edit before the pasted range keeps the chip on the same content', async () => {
    const ed = mount()
    ed.view.pasteHTML(CARD, pasteEvent())
    await settle()
    // 동료 편집 — Y 문서를 직접 고쳐 y-prosemirror 의 원격 반영 거래(문서 통째 교체)로 들어오게 한다.
    const ydoc = (ed.extensionManager.extensions.find((e) => e.name === 'collaboration')!.options as { document: Y.Doc }).document
    const frag = ydoc.getXmlFragment(COLLAB_FRAGMENT)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc))
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('동료 글')])
    peer.getXmlFragment(COLLAB_FRAGMENT).insert(0, [p])
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc)))
    expect(frag.length).toBeGreaterThan(0)
    expect(ed.state.doc.firstChild?.textContent).toBe('동료 글')
    const st = pasteChipState(ed.state)
    expect(st).not.toBeNull()
    const text = ed.state.doc.textBetween(st!.from, st!.to, '\n')
    expect(text).toContain('카드 빨강')
    expect(text).not.toContain('동료 글')
  })
  it('when a peer deleted the pasted range, the chip closes and 「글만」·「모양 유지」 never undo an unrelated step', async () => {
    const ed = mount()
    ed.commands.splitBlock()
    ed.view.pasteHTML(CARD, pasteEvent())
    await settle()
    // 동료가 붙인 내용(첫 문단 뒤 전부)을 지운다.
    const ydoc = (ed.extensionManager.extensions.find((e) => e.name === 'collaboration')!.options as { document: Y.Doc }).document
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc))
    const f = peer.getXmlFragment(COLLAB_FRAGMENT)
    f.delete(1, f.length - 1)
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc)))
    await settle()
    const before = docToMarkdown(ed.state.doc)
    expect(before).toBe('앞 글')
    expect(pasteChipState(ed.state)).toBeNull()
    expect(choosePastePlain(ed)).toBe(false)
    expect(choosePasteShape(ed)).toBe(false)
    expect(docToMarkdown(ed.state.doc)).toBe(before)
  })
})

describe('changedRange / pastedRangeToPlain', () => {
  it('changedRange covers what the steps inserted, in new-document positions', () => {
    const ed = mount('가나다')
    const tr = ed.state.tr.insertText('XY', 2)
    expect(changedRange(tr)).toEqual({ from: 2, to: 4 })
    expect(changedRange(ed.state.tr)).toBeNull()
  })

  it('pastedRangeToPlain leaves a box that starts before the range alone', () => {
    const ed = mount('<div style="border: 1px solid red">\n\n안 <span style="color: #dc2626">색</span> 글\n\n</div>')
    // 상자 안 글자 범위만 — 상자는 범위보다 앞에서 시작했으므로 남고, 범위 안 인라인 모양만 빠진다.
    const state: EditorState = ed.state
    let from = 0
    let to = 0
    state.doc.descendants((n, pos) => {
      if (n.isTextblock) {
        from = pos + 1
        to = pos + 1 + n.content.size
      }
    })
    const out = pastedRangeToPlain(state.tr, from, to)
    const md = docToMarkdown(out.doc)
    expect(md).toContain('<div style="border: 1px solid red">')
    expect(md).toContain('안 색 글')
    expect(out.doc.slice(from, to)).toBeInstanceOf(Slice)
  })
})
