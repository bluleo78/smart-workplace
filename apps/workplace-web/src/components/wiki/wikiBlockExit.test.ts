// @vitest-environment jsdom
// WP-1288 — HTML 블록·모양 영역 밖으로 나가기. 노트 끝 블록 옆 줄로 옮기기(없으면 만들기), 모양 영역 끝 빈 줄 Enter·마지막 줄 ↓,
// 닫힌 HTML 블록 안 커서를 블록 통째 선택으로 바꾸는 플러그인을 편집기 상태로 본다(그리기 없이 — NodeView 는 WikiHtmlEmbedView.test.tsx).
import { COLLAB_FRAGMENT, WikiHtmlEmbedSchema, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { link } from './collabTestHarness'
import { arrowBesideBlock, exitBoxOnArrowDown, exitBoxOnEnter, moveBesideBlock } from './wikiBlockExit'
import { htmlEmbedSourceKey, htmlEmbedSourcePlugin, isHtmlEmbedSourceOpen, setHtmlEmbedSourceOpen } from './wikiHtmlEmbedSource'

/** NodeView 없이 열림 플러그인만 얹은 HTML 블록 — 선택 다듬기를 그리기 없이 본다. */
const EmbedWithSource = WikiHtmlEmbedSchema.extend({
  addProseMirrorPlugins() {
    return [htmlEmbedSourcePlugin(() => this.editor.isEditable)]
  },
})

let editor: Editor | null = null
const extra: Editor[] = []
afterEach(() => {
  editor?.destroy()
  editor = null
  extra.splice(0).forEach((e) => e.destroy())
})

const open = (md: string) => {
  editor = new Editor({ extensions: wikiSchemaExtensions({ htmlEmbed: EmbedWithSource }), content: md })
  return editor
}

/** 최상위 블록 이름과 글자 — 문서 모양 비교용. */
const blocks = (ed: Editor) => {
  const out: string[] = []
  ed.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}`))
  return out
}

/** 첫 노드(이름)의 앞 위치. */
const posOf = (ed: Editor, name: string) => {
  let at = -1
  ed.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type.name === name) at = pos
    return at < 0
  })
  return at
}

const EMBED = ['```html-embed', '<b>x</b>', '```'].join('\n')
const BOX = (inner: string) => `<div class="card">\n\n${inner}\n\n</div>`

describe('moveBesideBlock — 블록 옆 줄로', () => {
  it('노트 끝 블록이면 뒤에 빈 문단을 만들어 커서를 둔다', () => {
    const ed = open(`앞\n\n${EMBED}`)
    const at = posOf(ed, 'wikiHtmlEmbed')
    expect(moveBesideBlock(ed.state, ed.view.dispatch, at, ed.state.doc.nodeAt(at)!.nodeSize, 1)).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'wikiHtmlEmbed:<b>x</b>', 'paragraph:'])
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(ed.state.selection.$from.index(0)).toBe(2)
  })

  it('바로 옆이 문단이면 새로 만들지 않고 뒤 줄은 처음, 앞 줄은 끝으로 간다', () => {
    const ed = open(`앞 줄\n\n${EMBED}\n\n뒤 줄`)
    const at = posOf(ed, 'wikiHtmlEmbed')
    const size = ed.state.doc.nodeAt(at)!.nodeSize
    moveBesideBlock(ed.state, ed.view.dispatch, at, size, 1)
    expect(blocks(ed)).toHaveLength(3)
    expect(ed.state.selection.$from.parent.textContent).toBe('뒤 줄')
    expect(ed.state.selection.$from.parentOffset).toBe(0)
    moveBesideBlock(ed.state, ed.view.dispatch, at, size, -1)
    expect(ed.state.selection.$from.parent.textContent).toBe('앞 줄')
    expect(ed.state.selection.$from.parentOffset).toBe(3)
  })

  it('바로 옆이 다른 HTML 블록이면 그 숨은 소스로 들어가지 않고 사이에 빈 문단을 만든다', () => {
    const ed = open(`${EMBED}\n\n${EMBED}`)
    moveBesideBlock(ed.state, ed.view.dispatch, 0, ed.state.doc.firstChild!.nodeSize, 1)
    expect(blocks(ed)).toEqual(['wikiHtmlEmbed:<b>x</b>', 'paragraph:', 'wikiHtmlEmbed:<b>x</b>'])
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('노트 맨 앞 블록에서 앞으로 가면 앞에 빈 문단을 만든다', () => {
    const ed = open(EMBED)
    moveBesideBlock(ed.state, ed.view.dispatch, 0, ed.state.doc.firstChild!.nodeSize, -1)
    expect(blocks(ed)).toEqual(['paragraph:', 'wikiHtmlEmbed:<b>x</b>'])
    expect(ed.state.selection.from).toBe(1)
  })
})

describe('arrowBesideBlock — 화살표로 옆 블록에', () => {
  it('옆이 다른 HTML 블록이면 빈 줄을 만들지 않고 그 블록을 통째 선택한다', () => {
    const ed = open(`${EMBED}\n\n${EMBED}`)
    const first = ed.state.doc.firstChild!.nodeSize
    expect(arrowBesideBlock(ed.state, ed.view.dispatch, 0, first, 1)).toBe(true)
    expect(blocks(ed)).toHaveLength(2)
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    expect(ed.state.selection.from).toBe(first)
    // 되돌아 ↑ 도 앞 블록 선택 — 빈 줄은 생기지 않는다.
    arrowBesideBlock(ed.state, ed.view.dispatch, first, ed.state.doc.child(1).nodeSize, -1)
    expect(blocks(ed)).toHaveLength(2)
    expect(ed.state.selection.from).toBe(0)
  })

  it('옆이 모양 영역이면 그 안 가장 가까운 줄로, 옆에 아무것도 없을 때만 새 줄을 만든다', () => {
    const ed = open(`${EMBED}\n\n${BOX('카드 글')}`)
    arrowBesideBlock(ed.state, ed.view.dispatch, 0, ed.state.doc.firstChild!.nodeSize, 1)
    expect(ed.state.selection.$from.parent.textContent).toBe('카드 글')
    expect(blocks(ed)).toHaveLength(2)
    arrowBesideBlock(ed.state, ed.view.dispatch, 0, ed.state.doc.firstChild!.nodeSize, -1)
    expect(blocks(ed)).toEqual(['paragraph:', 'wikiHtmlEmbed:<b>x</b>', 'wikiHtmlBox:카드 글'])
  })
})

describe('모양 영역 밖으로 나가기', () => {
  /** 커서를 pos 에 둔다. */
  const caret = (ed: Editor, pos: number) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
  /** 영역 마지막 문단 끝 위치. */
  const boxLastEnd = (ed: Editor) => {
    const at = posOf(ed, 'wikiHtmlBox')
    return at + ed.state.doc.nodeAt(at)!.nodeSize - 2
  }

  it('영역 맨 끝 빈 문단에서 Enter 면 그 빈 문단을 빼고 영역 밖 새 줄로 나간다', () => {
    const ed = open(BOX('카드 글'))
    // 영역 끝에 빈 문단(Enter 로 늘어난 줄)을 만든다.
    ed.commands.insertContentAt(boxLastEnd(ed) + 1, { type: 'paragraph' })
    caret(ed, boxLastEnd(ed))
    expect(ed.state.selection.$from.parent.content.size).toBe(0)
    expect(exitBoxOnEnter(ed.state, ed.view.dispatch)).toBe(true)
    expect(blocks(ed)).toEqual(['wikiHtmlBox:카드 글', 'paragraph:'])
    expect(ed.state.doc.firstChild!.childCount).toBe(1)
    expect(ed.state.selection.$from.depth).toBe(1)
  })

  it('영역에 빈 문단 하나뿐이면 빼지 않고 밖으로만 나가고, 뒤에 문단이 있으면 그리로 간다', () => {
    const ed = open(`${BOX('x')}\n\n뒤`)
    // 영역 글자를 지워 빈 문단 하나만 남긴다.
    const at = posOf(ed, 'wikiHtmlBox')
    ed.view.dispatch(ed.state.tr.delete(at + 2, at + 3))
    caret(ed, at + 2)
    expect(exitBoxOnEnter(ed.state, ed.view.dispatch)).toBe(true)
    expect(blocks(ed)).toEqual(['wikiHtmlBox:', 'paragraph:뒤'])
    expect(ed.state.selection.$from.parent.textContent).toBe('뒤')
  })

  it('글자가 있는 줄·마지막이 아닌 빈 줄·영역 밖에서는 Enter 를 넘긴다(기본 문단 나누기)', () => {
    const ed = open(BOX('카드 글'))
    caret(ed, boxLastEnd(ed))
    expect(exitBoxOnEnter(ed.state, ed.view.dispatch)).toBe(false)
    // 빈 줄이 마지막이 아니면(뒤에 글이 있으면) 그대로.
    ed.commands.insertContentAt(posOf(ed, 'wikiHtmlBox') + 1, { type: 'paragraph' })
    caret(ed, posOf(ed, 'wikiHtmlBox') + 2)
    expect(ed.state.selection.$from.parent.content.size).toBe(0)
    expect(exitBoxOnEnter(ed.state, ed.view.dispatch)).toBe(false)
    const plain = open('그냥 문단\n\n')
    plain.commands.insertContentAt(plain.state.doc.content.size, { type: 'paragraph' })
    caret(plain, plain.state.doc.content.size - 1)
    expect(exitBoxOnEnter(plain.state, plain.view.dispatch)).toBe(false)
  })

  it('노트 끝 영역의 마지막 줄 끝에서 ↓ 면 영역 밖에 새 줄을 만든다 — 줄 중간·마지막 화면 줄이 아니면 넘긴다', () => {
    const ed = open(BOX('카드 글'))
    caret(ed, boxLastEnd(ed) - 1)
    expect(exitBoxOnArrowDown(ed.state, ed.view.dispatch, true)).toBe(false)
    caret(ed, boxLastEnd(ed))
    expect(exitBoxOnArrowDown(ed.state, ed.view.dispatch, false)).toBe(false)
    expect(exitBoxOnArrowDown(ed.state, ed.view.dispatch, true)).toBe(true)
    expect(blocks(ed)).toEqual(['wikiHtmlBox:카드 글', 'paragraph:'])
    expect(ed.state.selection.$from.depth).toBe(1)
  })

  it('영역 뒤에 갈 줄이 있으면 ↓ 를 넘긴다(브라우저 기본 이동)', () => {
    const ed = open(`${BOX('카드 글')}\n\n뒤`)
    caret(ed, boxLastEnd(ed))
    expect(exitBoxOnArrowDown(ed.state, ed.view.dispatch, true)).toBe(false)
  })

  it('중첩 영역은 안쪽부터 한 겹씩 나간다', () => {
    const ed = open(BOX(BOX('안')))
    const inner = posOf(ed, 'wikiHtmlBox') + 1
    expect(ed.state.doc.nodeAt(inner)!.type.name).toBe('wikiHtmlBox')
    caret(ed, inner + ed.state.doc.nodeAt(inner)!.nodeSize - 2)
    expect(exitBoxOnArrowDown(ed.state, ed.view.dispatch, true)).toBe(true)
    // 바깥 영역 안, 안쪽 영역 뒤 새 줄.
    expect(ed.state.selection.$from.depth).toBe(2)
    expect(ed.state.selection.$from.node(1).type.name).toBe('wikiHtmlBox')
    expect(exitBoxOnArrowDown(ed.state, ed.view.dispatch, true)).toBe(true)
    expect(ed.state.selection.$from.depth).toBe(1)
    expect(blocks(ed)).toEqual(['wikiHtmlBox:안', 'paragraph:'])
  })
})

describe('닫힌 HTML 블록 선택 다듬기', () => {
  it('닫힌 블록 안 커서는 블록 통째 선택이 되고, 연 블록 안 커서는 그대로다', () => {
    const ed = open(`앞\n\n${EMBED}`)
    const at = posOf(ed, 'wikiHtmlEmbed')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at + 2)))
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    expect(ed.state.selection.from).toBe(at)
    // 열면 커서가 들어간다.
    ed.view.dispatch(setHtmlEmbedSourceOpen(ed.state.tr, at, true).setSelection(TextSelection.create(ed.state.doc, at + 2)))
    expect(isHtmlEmbedSourceOpen(ed.state, at)).toBe(true)
    expect(ed.state.selection).toBeInstanceOf(TextSelection)
    // 커서가 안에 있을 때 닫으면 통째 선택으로 바뀐다(숨은 칸에 커서가 남지 않는다).
    ed.view.dispatch(setHtmlEmbedSourceOpen(ed.state.tr, at, false))
    expect(isHtmlEmbedSourceOpen(ed.state, at)).toBe(false)
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
  })

  it('열림은 블록을 따라 움직이고, 블록이 지워지면 함께 사라진다', () => {
    const ed = open(`앞\n\n${EMBED}`)
    const at = posOf(ed, 'wikiHtmlEmbed')
    ed.view.dispatch(setHtmlEmbedSourceOpen(ed.state.tr, at, true))
    ed.view.dispatch(ed.state.tr.insertText('더', 1))
    expect(isHtmlEmbedSourceOpen(ed.state, at)).toBe(false)
    expect(isHtmlEmbedSourceOpen(ed.state, at + 1)).toBe(true)
    ed.view.dispatch(ed.state.tr.delete(at + 1, ed.state.doc.content.size))
    expect(isHtmlEmbedSourceOpen(ed.state, at + 1)).toBe(false)
  })

  it('블록 밖까지 걸친 선택은 그대로 두고, 편집할 수 없는 화면은 건드리지 않는다', () => {
    const ed = open(`앞\n\n${EMBED}`)
    const at = posOf(ed, 'wikiHtmlEmbed')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1, at + 2)))
    expect(ed.state.selection).toBeInstanceOf(TextSelection)
    ed.setEditable(false)
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at + 2)))
    expect(ed.state.selection).toBeInstanceOf(TextSelection)
  })

  it('통째 선택된 블록에 글자를 치면 블록이 글자로 바뀌지 않는다', () => {
    const ed = open(EMBED)
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, 0)))
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, 0, 0, 'a', () => ed.state.tr))
    expect(handled).toBe(true)
    expect(blocks(ed)).toEqual(['wikiHtmlEmbed:<b>x</b>'])
  })

  it('통째 선택된 블록에서 글자 키·IME 조합 키를 누르면 블록 다음 줄로 옮긴다 — 단축키는 그대로', () => {
    const ed = open(`${EMBED}\n\n뒤`)
    const press = (init: KeyboardEventInit) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', init)))
    const select = () => ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, 0)))
    select()
    press({ key: 'c', ctrlKey: true })
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    press({ key: 'Process', keyCode: 229 })
    expect(ed.state.selection.$from.parent.textContent).toBe('뒤')
    expect(blocks(ed)).toEqual(['wikiHtmlEmbed:<b>x</b>', 'paragraph:뒤'])
    select()
    press({ key: 'a' })
    expect(ed.state.selection.$from.parent.textContent).toBe('뒤')
  })
})

describe('동시 편집에서 열림 유지', () => {
  /** 같은 문서를 보는 두 편집기 — 나(me)와 동료(peer). 열림 플러그인을 얹은 HTML 블록을 쓴다. */
  const pair = (md: string) => {
    const [a, b] = [new Y.Doc(), new Y.Doc()]
    link(a, b)
    const make = (doc: Y.Doc) =>
      new Editor({
        extensions: [...wikiSchemaExtensions({ htmlEmbed: EmbedWithSource }), Collaboration.configure({ document: doc, field: COLLAB_FRAGMENT })],
      })
    const me = make(a)
    const peer = make(b)
    extra.push(me, peer)
    me.commands.setContent(md)
    return { me, peer }
  }

  it('동료가 다른 곳을 고쳐도(문서 통째 바꾸기로 반영) 연 소스 칸과 그 안 커서가 그대로다', () => {
    const { me, peer } = pair(`앞\n\n${EMBED}`)
    const at = posOf(me, 'wikiHtmlEmbed')
    me.view.dispatch(setHtmlEmbedSourceOpen(me.state.tr, at, true).setSelection(TextSelection.create(me.state.doc, at + 2)))
    peer.view.dispatch(peer.state.tr.insertText('더', 1))
    expect(me.state.doc.firstChild!.textContent).toBe('더앞')
    expect(isHtmlEmbedSourceOpen(me.state, at + 1)).toBe(true)
    expect(me.state.selection).toBeInstanceOf(TextSelection)
    expect(me.state.selection.$from.parent.type.name).toBe('wikiHtmlEmbed')
  })

  it('동료가 그 블록 소스를 함께 고쳐도 열린 채고, 블록을 지우면 열림도 사라진다', () => {
    const { me, peer } = pair(`앞\n\n${EMBED}`)
    const at = posOf(me, 'wikiHtmlEmbed')
    me.view.dispatch(setHtmlEmbedSourceOpen(me.state.tr, at, true))
    peer.view.dispatch(peer.state.tr.insertText('!', at + 1))
    expect(me.state.doc.nodeAt(at)!.textContent).toBe('!<b>x</b>')
    expect(isHtmlEmbedSourceOpen(me.state, at)).toBe(true)
    peer.view.dispatch(peer.state.tr.delete(at, peer.state.doc.content.size))
    expect(posOf(me, 'wikiHtmlEmbed')).toBe(-1)
    expect(htmlEmbedSourceKey.getState(me.state)!.find()).toHaveLength(0)
  })

  it('내가 통째 선택한 노트 끝 블록을 동료가 지워도 그 반영이 내 화면에 들어온다', () => {
    const { me, peer } = pair(`앞\n\n${EMBED}`)
    const at = posOf(me, 'wikiHtmlEmbed')
    me.view.dispatch(me.state.tr.setSelection(NodeSelection.create(me.state.doc, at)))
    peer.view.dispatch(peer.state.tr.delete(at, peer.state.doc.content.size))
    expect(blocks(me)).toEqual(['paragraph:앞'])
    // 남아 있는 블록을 통째 선택한 채 동료가 다른 곳을 고치면 선택도 그대로 블록이다.
    const again = pair(`앞\n\n${EMBED}\n\n뒤`)
    const pos = posOf(again.me, 'wikiHtmlEmbed')
    again.me.view.dispatch(again.me.state.tr.setSelection(NodeSelection.create(again.me.state.doc, pos)))
    again.peer.view.dispatch(again.peer.state.tr.insertText('더', 1))
    expect(again.me.state.selection).toBeInstanceOf(NodeSelection)
    expect(again.me.state.selection.from).toBe(pos + 1)
  })
})
