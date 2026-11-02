// @vitest-environment jsdom
// WP-1303 — 노트 「상자」(모양 영역 wikiHtmlBox 를 사용자 블록으로). 만들기(슬래시·감싸기)·통째 선택·상자 막대 동작(줄 추가·글만 남기기·삭제)·
// 상자 키 규칙·동시 편집을 편집기 상태로 본다(그리기·배치는 E2E wiki-box.spec.ts).
import { COLLAB_FRAGMENT, docToMarkdown, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { link } from './collabTestHarness'
import {
  addLineBesideBox,
  BOX_BASIC_STYLE,
  canWrapInBox,
  deleteBox,
  escapeBox,
  insertBox,
  selectedBox,
  unwrapBox,
  WikiBox,
  wrapInBox,
} from './wikiBox'

let editor: Editor | null = null
const extra: Editor[] = []
afterEach(() => {
  editor?.destroy()
  editor = null
  extra.splice(0).forEach((e) => e.destroy())
})

const open = (md: string) => {
  editor = new Editor({ extensions: [...wikiSchemaExtensions(), WikiBox], content: md })
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

/** 글자 text 가 시작하는 위치. */
const textAt = (ed: Editor, text: string) => {
  let at = -1
  ed.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text!.includes(text)) at = pos + n.text!.indexOf(text)
  })
  return at
}

const caret = (ed: Editor, pos: number) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
const selectBoxAt = (ed: Editor, pos: number) => ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)))
/** 편집기 키 처리(단축키·플러그인)에 키 하나를 넣는다 — 처리됐으면 참. */
const press = (ed: Editor, key: string) =>
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))) ?? false

const BOX = (inner: string, attrs = 'class="card"') => `<div ${attrs}>\n\n${inner}\n\n</div>`

describe('insertBox — 슬래시 「상자」', () => {
  it('빈 줄이면 그 줄을 「기본」 모양 빈 상자로 바꾸고 커서를 상자 안에 둔다', () => {
    const ed = open('앞\n\n')
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph' })
    caret(ed, ed.state.doc.content.size - 1)
    expect(ed.commands.command(insertBox)).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'wikiHtmlBox:'])
    const box = ed.state.doc.lastChild!
    expect(box.attrs.style).toBe(BOX_BASIC_STYLE)
    expect(box.childCount).toBe(1)
    expect(ed.state.selection.$from.node(1).type.name).toBe('wikiHtmlBox')
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('글자가 있는 줄이면 그 줄 뒤에 상자를 넣는다', () => {
    const ed = open('글\n\n뒤')
    caret(ed, textAt(ed, '글') + 1)
    expect(ed.commands.command(insertBox)).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:글', 'wikiHtmlBox:', 'paragraph:뒤'])
    expect(ed.state.selection.$from.node(1).type.name).toBe('wikiHtmlBox')
  })

  it('목록 첫 줄(빈 줄)에서는 목록 항목 첫 문단을 바꾸지 않고 그 뒤에 넣는다', () => {
    const ed = open('- 항목')
    caret(ed, textAt(ed, '항목') + 2)
    ed.commands.splitListItem('listItem')
    // 새 빈 항목 — 항목의 첫 자식은 문단이어야 하므로 빈 문단을 상자로 바꾸지 않는다.
    expect(ed.commands.command(insertBox)).toBe(true)
    const item = ed.state.doc.firstChild!.lastChild!
    expect(item.firstChild!.type.name).toBe('paragraph')
    expect(item.lastChild!.type.name).toBe('wikiHtmlBox')
  })

  it('저장(마크다운)하고 다시 읽어도 모양 그대로 상자다', () => {
    const ed = open('')
    expect(ed.commands.command(insertBox)).toBe(true)
    ed.commands.insertContent('카드 글')
    const md = (ed.storage as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
    expect(md).toContain(`<div style="${BOX_BASIC_STYLE}">`)
    const again = new Editor({ extensions: wikiSchemaExtensions(), content: md })
    extra.push(again)
    expect(blocks(again)).toEqual(['wikiHtmlBox:카드 글'])
    expect(again.state.doc.firstChild!.attrs.style).toBe(BOX_BASIC_STYLE)
  })
})

describe('wrapInBox — 상자로 감싸기', () => {
  it('고른 블록들을 「기본」 모양 상자 하나로 감싸고 그 상자를 통째 선택한다', () => {
    const ed = open('하나\n\n둘\n\n셋')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textAt(ed, '하나') + 1, textAt(ed, '둘') + 1)))
    expect(canWrapInBox(ed.state)).toBe(true)
    expect(wrapInBox(ed.state, ed.view.dispatch)).toBe(true)
    expect(blocks(ed)).toEqual(['wikiHtmlBox:하나둘', 'paragraph:셋'])
    expect(ed.state.doc.firstChild!.attrs.style).toBe(BOX_BASIC_STYLE)
    expect(selectedBox(ed.state)?.pos).toBe(0)
  })

  it('선택 끝이 다음 줄 맨 앞에 걸쳤으면(낱말 더블클릭·줄 끝까지 끌기) 그 줄은 감싸지 않는다', () => {
    const ed = open('하나\n\n둘')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textAt(ed, '하나'), textAt(ed, '둘'))))
    expect(wrapInBox(ed.state, ed.view.dispatch)).toBe(true)
    expect(blocks(ed)).toEqual(['wikiHtmlBox:하나', 'paragraph:둘'])
  })

  it('선택 끝이 목록 첫 줄 맨 앞에 걸쳐도 그 목록은 감싸지 않는다(줄 앞 경계가 목록 안이라 목록째 들어가던 것)', () => {
    const ed = open('하나\n\n- 가\n- 나')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textAt(ed, '하나'), textAt(ed, '가'))))
    expect(wrapInBox(ed.state, ed.view.dispatch)).toBe(true)
    expect(blocks(ed)).toEqual(['wikiHtmlBox:하나', 'bulletList:가나'])
  })

  it('목록 안 글을 고르면 목록째 감싼다(항목 첫 줄은 문단이어야 한다)', () => {
    const ed = open('- 가\n- 나')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textAt(ed, '가'), textAt(ed, '가') + 1)))
    expect(wrapInBox(ed.state, ed.view.dispatch)).toBe(true)
    const box = ed.state.doc.firstChild!
    expect(box.type.name).toBe('wikiHtmlBox')
    expect(box.firstChild!.type.name).toBe('bulletList')
  })

  it('코드 글자(코드 블록·열린 HTML 블록 소스) 안의 선택은 감싸지 않는다', () => {
    const ed = open('```\nconst a = 1\n```')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textAt(ed, 'const'), textAt(ed, 'const') + 5)))
    expect(canWrapInBox(ed.state)).toBe(false)
  })

  it('빈 선택·표 안·이미 통째 선택한 노드에서는 감쌀 수 없다', () => {
    const ed = open('글')
    caret(ed, 1)
    expect(canWrapInBox(ed.state)).toBe(false)
    const table = open('| a | b |\n| --- | --- |\n| c | d |')
    table.view.dispatch(table.state.tr.setSelection(TextSelection.create(table.state.doc, textAt(table, 'c'), textAt(table, 'c') + 1)))
    expect(canWrapInBox(table.state)).toBe(false)
    const boxed = open(BOX('안'))
    selectBoxAt(boxed, 0)
    expect(canWrapInBox(boxed.state)).toBe(false)
  })
})

describe('상자 막대 — 줄 추가·글만 남기기·삭제', () => {
  it('↑ 줄 추가·↓ 줄 추가는 옆 줄이 있어도 상자 바로 위·아래(상자 밖)에 빈 줄을 새로 만들고 커서를 둔다', () => {
    const ed = open(`앞\n\n${BOX('안')}\n\n뒤`)
    const at = posOf(ed, 'wikiHtmlBox')
    expect(addLineBesideBox(ed.state, ed.view.dispatch, at, -1)).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'paragraph:', 'wikiHtmlBox:안', 'paragraph:뒤'])
    expect(ed.state.selection.$from.depth).toBe(1)
    expect(ed.state.selection.$from.index(0)).toBe(1)
    const moved = posOf(ed, 'wikiHtmlBox')
    expect(addLineBesideBox(ed.state, ed.view.dispatch, moved, 1)).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'paragraph:', 'wikiHtmlBox:안', 'paragraph:', 'paragraph:뒤'])
    expect(ed.state.selection.$from.index(0)).toBe(3)
  })

  it('글만 남기기는 상자 모양을 떼고 안 블록을 보통 블록으로 남긴다(붙여넣기 거르기와 같은 풀기 — 안 배지 모양도 뗀다)', () => {
    const ed = open(`앞\n\n${BOX('첫 <span class="badge">배지</span>\n\n- 목록')}`)
    const at = posOf(ed, 'wikiHtmlBox')
    expect(unwrapBox(ed.state, ed.view.dispatch, at)).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'paragraph:첫 배지', 'bulletList:목록'])
    let shaped = false
    ed.state.doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === 'wikiHtmlSpan')) shaped = true
    })
    expect(shaped).toBe(false)
    // 커서는 풀린 첫 줄에.
    expect(ed.state.selection.$from.parent.textContent).toBe('첫 배지')
  })

  it('글만 남기기는 상자 안 페이지 스타일(노트 전체 CSS)을 지우지 않고 상자 밖으로 꺼내 남긴다', () => {
    const ed = open('앞')
    const { wikiStyle, wikiHtmlBox, paragraph } = ed.state.schema.nodes
    const box = wikiHtmlBox!.create({ style: BOX_BASIC_STYLE }, [
      wikiStyle!.create({ css: '.card{color:red}' }),
      paragraph!.create(null, ed.state.schema.text('카드')),
    ])
    ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, box))
    expect(unwrapBox(ed.state, ed.view.dispatch, posOf(ed, 'wikiHtmlBox'))).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'paragraph:카드', 'wikiStyle:'])
    expect(ed.state.doc.lastChild!.attrs.css).toBe('.card{color:red}')
  })

  // WP-1305 — 선택 서식 도구로 단 밑줄·글자색(class 없는 서식 span)은 글 서식이라 「글만 남기기」 뒤에도 남는다. 배지(class span)는 뗀다.
  it('글만 남기기는 서식 span(밑줄·색)은 남기고 배지 같은 class span 만 뗀다', () => {
    const fmt = '<span style="text-decoration: underline; color: var(--wiki-text-red, #dc2626)">빨강</span>'
    const ed = open(`${BOX(`${fmt} <span class="badge">배지</span>`)}`)
    expect(unwrapBox(ed.state, ed.view.dispatch, posOf(ed, 'wikiHtmlBox'))).toBe(true)
    expect(docToMarkdown(ed.state.doc)).toBe(`${fmt} 배지`)
  })

  it('삭제는 상자를 안 내용째 지운다', () => {
    const ed = open(`앞\n\n${BOX('안')}\n\n뒤`)
    expect(deleteBox(ed.state, ed.view.dispatch, posOf(ed, 'wikiHtmlBox'))).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'paragraph:뒤'])
  })

  it('그 자리에 상자가 없으면(동료가 지움) 아무것도 하지 않는다', () => {
    const ed = open('글')
    expect(addLineBesideBox(ed.state, ed.view.dispatch, 0, 1)).toBe(false)
    expect(unwrapBox(ed.state, ed.view.dispatch, 0)).toBe(false)
    expect(deleteBox(ed.state, ed.view.dispatch, 0)).toBe(false)
  })
})

describe('상자 통째 선택 키', () => {
  it('Enter·↓ 는 다음 줄로(없으면 만든다), ↑ 는 앞 줄로 간다', () => {
    const ed = open(`앞\n\n${BOX('안')}`)
    const at = posOf(ed, 'wikiHtmlBox')
    selectBoxAt(ed, at)
    expect(press(ed, 'Enter')).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'wikiHtmlBox:안', 'paragraph:'])
    expect(ed.state.selection.$from.index(0)).toBe(2)
    selectBoxAt(ed, at)
    expect(press(ed, 'ArrowDown')).toBe(true)
    expect(blocks(ed)).toHaveLength(3)
    expect(ed.state.selection.$from.index(0)).toBe(2)
    selectBoxAt(ed, at)
    expect(press(ed, 'ArrowUp')).toBe(true)
    expect(ed.state.selection.$from.parent.textContent).toBe('앞')
  })

  it('Delete·Backspace 는 상자를 지운다', () => {
    const ed = open(`앞\n\n${BOX('안')}\n\n뒤`)
    selectBoxAt(ed, posOf(ed, 'wikiHtmlBox'))
    expect(press(ed, 'Backspace')).toBe(true)
    expect(blocks(ed)).toEqual(['paragraph:앞', 'paragraph:뒤'])
  })

  it('글자를 치면 상자를 덮어쓰지 않고 다음 줄로 옮겨 그 줄에 쓴다', () => {
    const ed = open(BOX('안'))
    selectBoxAt(ed, 0)
    press(ed, 'a')
    expect(ed.view.someProp('handleTextInput', (f) => f(ed.view, 0, 0, 'a', () => ed.state.tr))).toBeFalsy()
    expect(blocks(ed)).toEqual(['wikiHtmlBox:안', 'paragraph:'])
    expect(ed.state.selection.$from.index(0)).toBe(1)
  })
})

describe('escapeBox — Esc 는 한 단계 바깥으로', () => {
  it('상자 안 글 줄에서 Esc 면 그 상자를 통째 선택한다', () => {
    const ed = open(`앞\n\n${BOX('안 글')}`)
    caret(ed, textAt(ed, '안 글') + 1)
    expect(press(ed, 'Escape')).toBe(true)
    expect(selectedBox(ed.state)?.pos).toBe(posOf(ed, 'wikiHtmlBox'))
  })

  it('통째 선택된 상자에서 Esc 면 바깥 상자를, 바깥이 노트면 옆 글 줄로 나간다', () => {
    const ed = open(`앞\n\n${BOX(BOX('안', 'class="inner"'))}`)
    const outer = posOf(ed, 'wikiHtmlBox')
    selectBoxAt(ed, outer + 1)
    expect(escapeBox(ed.state, ed.view.dispatch)).toBe(true)
    expect(selectedBox(ed.state)?.pos).toBe(outer)
    expect(escapeBox(ed.state, ed.view.dispatch)).toBe(true)
    expect(ed.state.selection).toBeInstanceOf(TextSelection)
    expect(ed.state.selection.$from.parent.textContent).toBe('앞')
  })

  it('상자 밖 글 줄에서는 Esc 를 넘긴다', () => {
    const ed = open('글')
    caret(ed, 1)
    expect(escapeBox(ed.state, ed.view.dispatch)).toBe(false)
  })
})

describe('상자 테두리·여백 누르기', () => {
  /** 편집기 클릭 처리(handleClickOn)를 직접 부른다 — direct 는 그 노드가 누른 자리의 가장 안쪽 노드인지. */
  const clickOn = (ed: Editor, nodePos: number, direct: boolean) =>
    ed.view.someProp('handleClickOn', (f) =>
      f(ed.view, nodePos + 1, ed.state.doc.nodeAt(nodePos)!, nodePos, new MouseEvent('click'), direct),
    ) ?? false

  it('상자 자신(테두리·여백)을 누르면 상자를 통째 선택하고, 안 글을 누르면(상자가 바깥 노드) 넘긴다', () => {
    const ed = open(`앞\n\n${BOX('안')}`)
    const at = posOf(ed, 'wikiHtmlBox')
    expect(clickOn(ed, at, false)).toBe(false)
    expect(selectedBox(ed.state)).toBeNull()
    expect(clickOn(ed, at, true)).toBe(true)
    expect(selectedBox(ed.state)?.pos).toBe(at)
  })

  it('보기 전용이면 고르지 않는다', () => {
    const ed = open(BOX('안'))
    ed.setEditable(false)
    expect(clickOn(ed, 0, true)).toBe(false)
  })
})

describe('동시 편집', () => {
  /** 같은 문서를 보는 두 편집기 — 나(me)와 동료(peer). */
  const pair = (md: string) => {
    const [a, b] = [new Y.Doc(), new Y.Doc()]
    link(a, b)
    const make = (doc: Y.Doc) =>
      new Editor({ extensions: [...wikiSchemaExtensions(), WikiBox, Collaboration.configure({ document: doc, field: COLLAB_FRAGMENT })] })
    const me = make(a)
    const peer = make(b)
    extra.push(me, peer)
    me.commands.setContent(md)
    return { me, peer }
  }

  it('한 사람은 상자 안, 다른 사람은 상자 밖을 함께 고쳐도 두 화면이 같은 문서로 모인다', () => {
    const { me, peer } = pair(`앞\n\n${BOX('안')}\n\n뒤`)
    me.view.dispatch(me.state.tr.insertText('내가', textAt(me, '안')))
    peer.view.dispatch(peer.state.tr.insertText('동료', textAt(peer, '뒤')))
    expect(blocks(me)).toEqual(['paragraph:앞', 'wikiHtmlBox:내가안', 'paragraph:동료뒤'])
    expect(blocks(peer)).toEqual(blocks(me))
    expect(me.state.doc.child(1).attrs.className).toBe('card')
  })

  it('내가 상자를 통째 선택한 채 동료가 그 안을 고쳐도 선택(막대)이 그대로다', () => {
    const { me, peer } = pair(`앞\n\n${BOX('안')}\n\n뒤`)
    const at = posOf(me, 'wikiHtmlBox')
    selectBoxAt(me, at)
    peer.view.dispatch(peer.state.tr.insertText('더', textAt(peer, '안')))
    expect(me.state.doc.child(1).textContent).toBe('더안')
    expect(selectedBox(me.state)?.pos).toBe(at)
    peer.view.dispatch(peer.state.tr.insertText('!', 1))
    expect(selectedBox(me.state)?.pos).toBe(at + 1)
  })

  it('안쪽 상자 하나만 담은 바깥 상자를 통째 선택한 채 동료가 고쳐도 바깥 상자 선택이 그대로다(안쪽으로 바뀌지 않는다)', () => {
    const { me, peer } = pair(`앞\n\n${BOX(BOX('안', 'class="inner"'))}\n\n뒤`)
    const at = posOf(me, 'wikiHtmlBox')
    selectBoxAt(me, at)
    peer.view.dispatch(peer.state.tr.insertText('더', textAt(peer, '안')))
    expect(selectedBox(me.state)?.pos).toBe(at)
    expect(selectedBox(me.state)?.node.attrs.className).toBe('card')
  })

  it('내가 통째 선택한 노트 끝 상자를 동료가 지워도 그 반영이 내 화면에 들어온다', () => {
    const { me, peer } = pair(`앞\n\n${BOX('안')}`)
    const at = posOf(me, 'wikiHtmlBox')
    selectBoxAt(me, at)
    peer.view.dispatch(peer.state.tr.delete(at, peer.state.doc.content.size))
    expect(blocks(me)).toEqual(['paragraph:앞'])
  })

  it('내가 상자를 글만 남기는 동안 동료가 상자 밖을 고쳐도 두 화면이 같다', () => {
    const { me, peer } = pair(`앞\n\n${BOX('안')}`)
    unwrapBox(me.state, me.view.dispatch, posOf(me, 'wikiHtmlBox'))
    peer.view.dispatch(peer.state.tr.insertText('동료', 1))
    expect(blocks(me)).toEqual(['paragraph:동료앞', 'paragraph:안'])
    expect(blocks(peer)).toEqual(blocks(me))
  })
})
