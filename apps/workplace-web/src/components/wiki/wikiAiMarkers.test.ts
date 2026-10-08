// @vitest-environment jsdom
import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import type { CollabAiMarker } from '@smart-workplace/wiki-editor-schema/collab-protocol'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { Schema } from '@tiptap/pm/model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { type Box, markerPos, placeTags, remoteAiMarkers, type TagMeasure, WikiAiMarkers, wikiAiMarkersKey } from './wikiAiMarkers'
import { toRelative } from './wikiCollabPosition'

const anchor = { type: null, tname: 'default', item: null, assoc: 0 }
const marker = (id: string, name: string) => ({ id, userId: 5, name, anchor })

describe('remoteAiMarkers', () => {
  it("collects other clients' markers (server included) and skips my own", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { aiMarkers: [marker('mine', '나')] }],
      [2, { aiMarkers: [marker('a', '양동희')] }],
      [3, { aiMarkers: null }],
      [4, {}],
      [5, { aiMarkers: [{ broken: true }, marker('b', '이영희')] }],
    ])
    expect(remoteAiMarkers(states, 1)).toEqual([
      { clientId: 2, marker: marker('a', '양동희') },
      { clientId: 5, marker: marker('b', '이영희') },
    ])
  })
})

// 표식 위치 — 글 안이면 그 자리, 블록 경계(서버 표식)면 그 블록의 첫 글 상자 맨 앞.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    list: { group: 'block', content: 'item+' },
    item: { content: 'paragraph' },
    text: {},
  },
})
const p = (t: string) => schema.node('paragraph', null, t ? [schema.text(t)] : [])
// doc: <p>가나</p>(0..4) <list><item><p>다</p></item></list>(4..11)
const doc = schema.node('doc', null, [p('가나'), schema.node('list', null, [schema.node('item', null, [p('다')])])])

describe('markerPos', () => {
  it('keeps a position inside text as is', () => {
    expect(markerPos(doc, 2)).toBe(2)
  })
  it('moves a block boundary into the start of that paragraph', () => {
    expect(markerPos(doc, 0)).toBe(1)
  })
  it('moves a boundary before a list into its first paragraph', () => {
    expect(markerPos(doc, 4)).toBe(7)
  })
  it('clamps positions past the end', () => {
    expect(markerPos(doc, 999)).toBe(doc.content.size)
  })
})

// 표식 위치가 Yjs 상대 위치라 이후 편집(원격·내 편집)을 따라가는지 — 실제 y-prosemirror 두 편집자로 확인한다.

/** 두 Y.Doc 을 서로 동기화한다(동기화 서버 대신). */
function link(a: Y.Doc, b: Y.Doc) {
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== b && Y.applyUpdate(b, u, a))
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== a && Y.applyUpdate(a, u, b))
}

/** awareness 흉내 — 표식 확장이 쓰는 clientID·getStates·on/off 만. set 으로 다른 접속자 상태를 바꾸고 change 를 알린다. */
function fakeAwareness(clientID: number) {
  type Changes = { added: number[]; updated: number[]; removed: number[] }
  const states = new Map<number, Record<string, unknown>>()
  const listeners = new Set<(changes: Changes) => void>()
  return {
    clientID,
    getStates: () => states,
    on: (_e: 'change', fn: (changes: Changes) => void) => listeners.add(fn),
    off: (_e: 'change', fn: (changes: Changes) => void) => listeners.delete(fn),
    /** y-protocols 처럼 바뀐 접속자를 added·updated·removed 로 알린다. */
    set(clientId: number, state: Record<string, unknown> | null) {
      const had = states.has(clientId)
      if (state) states.set(clientId, state)
      else states.delete(clientId)
      const changes: Changes = { added: [], updated: [], removed: [] }
      if (!state) changes.removed.push(clientId)
      else (had ? changes.updated : changes.added).push(clientId)
      listeners.forEach((fn) => fn(changes))
    },
  }
}

const editors: Editor[] = []
function makeEditor(ydoc: Y.Doc, awareness?: ReturnType<typeof fakeAwareness>): Editor {
  const editor = new Editor({
    extensions: [
      ...wikiSchemaExtensions(),
      Collaboration.configure({ document: ydoc, field: 'default' }),
      // 실제 HocuspocusProvider awareness 대신 흉내 객체를 넣는다(쓰는 면만 같다).
      WikiAiMarkers.configure({ awareness: (awareness ?? null) as never }),
    ],
  })
  editors.push(editor)
  return editor
}

/** 그려진 표식 위치들. */
const markerPositions = (editor: Editor) =>
  (wikiAiMarkersKey.getState(editor.state)?.find() ?? []).map((d) => d.from)
/** 그려진 표식 이름들(DOM). */
const markerNames = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('[data-testid="wiki-ai-marker"]')].map((el) => el.textContent)

/** 문서에서 글자 text 가 시작하는 위치. */
function startOf(editor: Editor, text: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return
    const idx = node.text!.indexOf(text)
    if (idx >= 0) found = pos + idx
  })
  if (found < 0) throw new Error(`no "${text}"`)
  return found
}

describe('WikiAiMarkers — 위치 추적', () => {
  afterEach(() => {
    editors.splice(0).forEach((e) => {
      if (!e.isDestroyed) e.destroy()
    })
  })

  /** A(표식을 그리는 쪽) 와 B(다른 편집자). 본문 "첫 문단 / 둘째 문단" 의 "둘째" 앞에 원격 표식을 단다. */
  function setup(name = '이영희') {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    link(docA, docB)
    const awareness = fakeAwareness(docA.clientID)
    const a = makeEditor(docA, awareness)
    const b = makeEditor(docB)
    b.commands.setContent('<p>첫 문단</p><p>둘째 문단</p>')
    const rel = toRelative(a.state, startOf(a, '둘째'))
    expect(rel).not.toBeNull()
    const m: CollabAiMarker = { id: 'm1', userId: 7, name, anchor: Y.relativePositionToJSON(rel!) }
    awareness.set(4242, { aiMarkers: [m] })
    return { a, b, awareness, m }
  }

  it('원격 표식을 그 자리에 이름과 함께 그린다', () => {
    const { a } = setup()
    expect(markerPositions(a)).toEqual([startOf(a, '둘째')])
    expect(markerNames(a)).toEqual(['이영희'])
  })

  it('이름이 비면 AI 로 보인다', () => {
    const { a } = setup('')
    expect(markerNames(a)).toEqual(['AI'])
  })

  it('다른 사람이 앞에 글을 넣으면 표식이 따라간다', () => {
    const { a, b } = setup()
    b.commands.insertContentAt(1, '앞에 넣은 글 ')
    expect(a.getText()).toContain('앞에 넣은 글 첫 문단')
    expect(markerPositions(a)).toEqual([startOf(a, '둘째')])
  })

  it('내가 앞에 글을 넣어도 표식이 따라간다', () => {
    const { a } = setup()
    a.commands.insertContentAt(1, '내가 넣은 글 ')
    expect(markerPositions(a)).toEqual([startOf(a, '둘째')])
    // 다음 트랜잭션이 와도 그대로다.
    a.commands.insertContentAt(startOf(a, '첫'), '또 ')
    expect(markerPositions(a)).toEqual([startOf(a, '둘째')])
  })

  it('표식 상태가 사라지면 지운다', () => {
    const { a, awareness } = setup()
    awareness.set(4242, null)
    expect(markerPositions(a)).toEqual([])
    expect(markerNames(a)).toEqual([])
  })

  it('내 awareness 의 표식은 그리지 않는다', () => {
    const { a, awareness, m } = setup()
    awareness.set(4242, null)
    awareness.set(awareness.clientID, { aiMarkers: [m] })
    expect(markerPositions(a)).toEqual([])
  })

  // awareness 는 커서·접속자 정보로 수시로 바뀐다 — 표식이 그대로면 다시 그리지(트랜잭션·배치 계산) 않는다(코드 리뷰 10).
  it('표식과 무관한 awareness 변화·같은 표식 재전송에는 트랜잭션을 만들지 않는다', () => {
    const { a, awareness, m } = setup()
    const dispatch = vi.spyOn(a.view, 'dispatch')
    awareness.set(77, { user: { name: '김철수' }, cursor: { anchor: 1 } })
    awareness.set(4242, { aiMarkers: [m], user: { name: '서버' } })
    expect(dispatch).not.toHaveBeenCalled()
    // 표식이 실제로 바뀌면(이름) 다시 그린다.
    awareness.set(4242, { aiMarkers: [{ ...m, name: '박민수' }] })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markerNames(a)).toEqual(['박민수'])
  })

  it('다시 계산해도 표식 위치·키가 같으면 태그 배치를 다시 하지 않는다', () => {
    const { a, b } = setup()
    const query = vi.spyOn(a.view.dom, 'querySelectorAll')
    const fits = () => query.mock.calls.filter(([sel]) => sel === '.wiki-ai-marker').length
    const widget = a.view.dom.querySelector('.wiki-ai-marker')
    query.mockClear()
    // 표식 뒤쪽 원격 편집(같은 문단) — Yjs 변화로 다시 계산하지만 표식은 그대로다.
    b.commands.insertContentAt(b.state.doc.content.size - 1, ' 뒤에 붙인 글')
    expect(a.getText()).toContain('뒤에 붙인 글')
    expect(fits()).toBe(0)
    // 위젯 DOM 도 그대로라(PM 이 키로 재사용) 앞서 맞춘 배치 클래스가 남는다.
    expect(a.view.dom.querySelector('.wiki-ai-marker')).toBe(widget)
    // 표식 앞 원격 편집 — 위치가 바뀌었으니 다시 놓는다.
    b.commands.insertContentAt(1, '앞 ')
    expect(markerPositions(a)).toEqual([startOf(a, '둘째')])
    expect(fits()).toBe(1)
  })

  it('동기화 전에 올라온 표식도 문서가 들어오면 그린다', () => {
    // B 에 본문과 표식 위치를 먼저 만들고, A 는 나중에 이어 붙인다(늦게 들어온 접속자).
    const docB = new Y.Doc()
    const b = makeEditor(docB)
    b.commands.setContent('<p>첫 문단</p><p>둘째 문단</p>')
    const rel = toRelative(b.state, startOf(b, '둘째'))!
    const docA = new Y.Doc()
    const awareness = fakeAwareness(docA.clientID)
    awareness.set(4242, { aiMarkers: [{ id: 'm1', userId: 7, name: '이영희', anchor: Y.relativePositionToJSON(rel) }] })
    const a = makeEditor(docA, awareness)
    expect(markerPositions(a)).toEqual([])
    link(docA, docB)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), docB)
    expect(markerPositions(a)).toEqual([startOf(a, '둘째')])
  })
})

// 태그 배치(WP-291 디자이너 리뷰 I-1·I-2) — 측정값만 넣는 순수 함수. 태그 높이 18, 캐럿 줄 100~116, 태그는 캐럿 위 2px.
describe('placeTags', () => {
  const WIDE: Box = { left: 0, right: 1000, top: -Infinity, bottom: Infinity }
  /** x 에 캐럿이 있는 표식 — 태그 폭 w, 기본 배치(오른쪽·위). */
  const at = (x: number, w = 60, clip: Box = WIDE, lineTop = 100): TagMeasure => ({
    tag: { left: x - 1, right: x - 1 + w, top: lineTop - 20, bottom: lineTop - 2 },
    marker: { top: lineTop, bottom: lineTop + 16 },
    clip,
  })
  const none = { flip: false, side: 'above', stack: 0 }

  it('stacks two tags at the same spot so both stay visible', () => {
    expect(placeTags([at(200), at(200)])).toEqual([none, { ...none, stack: 1 }])
  })

  it('stacks tags a few characters apart whose rects overlap', () => {
    expect(placeTags([at(200), at(246)])).toEqual([none, { ...none, stack: 1 }])
  })

  it('leaves far-apart tags and tags on different lines alone', () => {
    expect(placeTags([at(200), at(400), at(200, 60, WIDE, 160)])).toEqual([none, none, none])
  })

  it('climbs past every overlapping tag, not just the first', () => {
    expect(placeTags([at(200), at(200), at(220)]).map((p) => p.stack)).toEqual([0, 1, 2])
  })

  it('flips left at the right edge (editor or overflow ancestor, whichever is tighter)', () => {
    const clip = { ...WIDE, right: 230 }
    expect(placeTags([at(200, 60, clip)])).toEqual([{ ...none, flip: true }])
  })

  it('does not flip when flipping would overflow the left edge instead', () => {
    const clip = { ...WIDE, left: 180, right: 230 }
    expect(placeTags([at(200, 60, clip)])).toEqual([none])
  })

  it('opens below the caret when an overflow ancestor (table wrapper) cuts the top', () => {
    const table = { ...WIDE, top: 90 }
    expect(placeTags([at(200, 60, table)])).toEqual([{ ...none, side: 'below' }])
  })

  it('stacks below-tags downward', () => {
    const table = { ...WIDE, top: 90 }
    expect(placeTags([at(200, 60, table), at(200, 60, table)])).toEqual([
      { ...none, side: 'below' },
      { ...none, side: 'below', stack: 1 },
    ])
  })

  it('falls back to below when stacking upward would be cut by the overflow ancestor', () => {
    // 첫 태그는 위에 들어가지만(80 ≥ 70), 두 번째를 위로 쌓으면 59 < 70 이라 잘린다 → 아래로.
    const table = { ...WIDE, top: 70 }
    expect(placeTags([at(200, 60, table), at(200, 60, table)])).toEqual([none, { ...none, side: 'below' }])
  })

  it('puts the tag beside the caret when both above and below are cut (header-only table)', () => {
    // 감싸개 90~126: 위 태그(80)도, 아래 태그(118~136)도 잘린다 → 캐럿 옆(줄 안).
    const oneRow = { ...WIDE, top: 90, bottom: 126 }
    expect(placeTags([at(200, 60, oneRow)])).toEqual([{ ...none, side: 'inline' }])
  })

  it('keeps the below tag when it fits inside the wrapper bottom', () => {
    const table = { ...WIDE, top: 90, bottom: 136 }
    expect(placeTags([at(200, 60, table)])).toEqual([{ ...none, side: 'below' }])
  })
})
