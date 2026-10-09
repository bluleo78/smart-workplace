// @vitest-environment jsdom
import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { fakeAwareness, link, startOf } from './collabTestHarness'
import { LABEL_SHOW_MS } from './presenceLabels'
import { WikiAiMarkers } from './wikiAiMarkers'
import { toRelative } from './wikiCollabPosition'
import { SEQ_PUBLISH_MS, WikiPresenceCursors, wikiPresenceCursorsKey } from './wikiPresenceCursors'
import { SELECTOR } from './wikiTagLayout'

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((e) => !e.isDestroyed && e.destroy())
  vi.useRealTimers()
})

function makeEditor(
  doc: Y.Doc,
  awareness: ReturnType<typeof fakeAwareness> | null,
  hiddenRef = { current: false },
  withAiMarkers = false,
  selfUserIdRef: { current: number | null } | null = null,
) {
  const editor = new Editor({
    extensions: [
      ...wikiSchemaExtensions(),
      Collaboration.configure({ document: doc, field: 'default' }),
      ...(withAiMarkers ? [WikiAiMarkers.configure({ awareness: awareness as never })] : []),
      WikiPresenceCursors.configure({ awareness: awareness as never, hiddenRef, selfUserIdRef }),
    ],
  })
  editors.push(editor)
  return editor
}

/** A(보는 쪽, 나=userId 1) 와 B(원격 편집자). 본문 "첫 문단 / 둘째 문단". */
function setup(hiddenRef = { current: false }, withAiMarkers = false) {
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  link(docA, docB)
  const aw = fakeAwareness(docA.clientID)
  aw.setLocalState({ user: { id: 1, name: '나' } })
  const a = makeEditor(docA, aw, hiddenRef, withAiMarkers)
  const b = makeEditor(docB, null)
  b.commands.setContent('<p>첫 문단</p><p>둘째 문단</p>')
  const relAt = (text: string) => Y.relativePositionToJSON(toRelative(a.state, startOf(a, text))!)
  const cursorAt = (text: string) => ({ anchor: relAt(text), head: relAt(text) })
  return { a, b, aw, cursorAt }
}

const cursors = (e: Editor) => [...e.view.dom.querySelectorAll<HTMLElement>('.wiki-presence-cursor')]
const positions = (e: Editor) =>
  (wikiPresenceCursorsKey.getState(e.state)?.find() ?? []).filter((d) => (d.spec as { key?: string }).key).map((d) => d.from)

describe('WikiPresenceCursors — 그리기', () => {
  it('draws a remote cursor in the person color with the name only as data (not text)', () => {
    const { a, aw, cursorAt } = setup()
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('둘째') })
    expect(positions(a)).toEqual([startOf(a, '둘째')])
    const [el] = cursors(a)
    expect(el.dataset.userId).toBe('2')
    expect(el.style.getPropertyValue('--presence-color')).toMatch(/^var\(--presence-\d\)$/)
    expect(el.querySelector('.wiki-presence-cursor__tag')!.getAttribute('data-name')).toBe('김철수')
    // 이름은 글자 노드가 아니다 — 본문 textContent 에 섞이지 않는다.
    expect(a.view.dom.textContent).toBe('첫 문단둘째 문단')
  })

  it('skips states without a user, my own client and my other tabs', () => {
    const { a, aw, cursorAt } = setup()
    aw.set(501, { cursor: cursorAt('둘째') })
    aw.set(502, { user: { id: 1, name: '나' }, cursor: cursorAt('첫') })
    expect(cursors(a)).toHaveLength(0)
  })

  it('never draws my other tab (same login user id) even before my own state carries a user', () => {
    // 내 user 가 아직 안 올라간(announce 전·정리 뒤) 로컬 상태 — 로그인 사용자 id 로 뺀다(헤더와 같은 기준).
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    link(docA, docB)
    const aw = fakeAwareness(docA.clientID)
    const a = makeEditor(docA, aw, { current: false }, false, { current: 1 })
    const b = makeEditor(docB, null)
    b.commands.setContent('<p>첫 문단</p><p>둘째 문단</p>')
    const rel = Y.relativePositionToJSON(toRelative(a.state, startOf(a, '둘째'))!)
    aw.set(502, { user: { id: 1, name: '나' }, cursor: { anchor: rel, head: rel } })
    expect(cursors(a)).toHaveLength(0)
    aw.set(503, { user: { id: 2, name: '김철수' }, cursor: { anchor: rel, head: rel } })
    expect(cursors(a)).toHaveLength(1)
  })

  it('follows edits inserted above the cursor', () => {
    const { a, aw, cursorAt } = setup()
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('둘째') })
    a.commands.insertContentAt(1, '앞 ')
    expect(positions(a)).toEqual([startOf(a, '둘째')])
  })

  it('draws nothing while hidden (terminal) and again when shown', () => {
    const hiddenRef = { current: true }
    const { a, aw, cursorAt } = setup(hiddenRef)
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('둘째') })
    expect(cursors(a)).toHaveLength(0)
    hiddenRef.current = false
    a.view.dispatch(a.state.tr.setMeta(wikiPresenceCursorsKey, true))
    expect(cursors(a)).toHaveLength(1)
  })

  it('marks an AI-writing person and never shows their cursor label (the ✦ tag is the label)', () => {
    const { a, aw, cursorAt } = setup()
    aw.set(500, {
      user: { id: 3, name: '이영희' },
      cursor: cursorAt('둘째'),
      aiMarkers: [{ id: 'm', userId: 3, name: '이영희', anchor: cursorAt('둘째').head }],
    })
    const [el] = cursors(a)
    expect(el.dataset.ai).toBe('true')
    expect(el.hasAttribute('data-label-visible')).toBe(false)
  })
})

describe('WikiPresenceCursors — AI 작성 중(사람 단위)', () => {
  it('hides the cursor label of a person whose ✦ marker comes from another state (server-applied AI edit)', () => {
    const { a, aw, cursorAt } = setup()
    // 동기화 서버(user 없음)가 김철수의 AI 수정을 적용 중 — 표식은 서버 상태에, 커서는 김철수 상태에 있다.
    aw.set(4242, { aiMarkers: [{ id: 'm', userId: 2, name: '김철수', anchor: cursorAt('첫').head }] })
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('둘째') })
    const [el] = cursors(a)
    expect(el.dataset.ai).toBe('true')
    expect(el.hasAttribute('data-label-visible')).toBe(false)
    // 표식이 내려가면 다시 일반 커서다(다음 움직임부터 이름표).
    aw.set(4242, { aiMarkers: null })
    expect(cursors(a)[0].dataset.ai).toBeUndefined()
  })
})

describe('WikiPresenceCursors — 이름표 타이밍', () => {
  it('shows the label when the cursor moves, hides it after LABEL_SHOW_MS', () => {
    vi.useFakeTimers()
    const { a, aw, cursorAt } = setup()
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('첫') })
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(true)
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('둘째') })
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(true)
  })

  it('does not re-show on a renewal of the same cursor or on other field changes', () => {
    vi.useFakeTimers()
    const { a, aw, cursorAt } = setup()
    const cur = cursorAt('첫')
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cur })
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cur }) // 15초 갱신
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cur, aiMarkers: null })
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
  })
})

// 이름표 배치는 ✦ 표식과 함께 다음 프레임 한 번(wikiTagLayout scheduleFitTags) — 가짜 시계로 프레임을 넘겨 실제 배치 횟수를 센다.
describe('WikiPresenceCursors — 이름표 배치', () => {
  function withLayoutSpy(a: Editor) {
    vi.advanceTimersToNextFrame()
    const query = vi.spyOn(a.view.dom, 'querySelectorAll')
    return () => query.mock.calls.filter(([sel]) => sel === SELECTOR).length
  }

  it('refits once more when a label hides, so its stale placement is cleared', () => {
    vi.useFakeTimers()
    const { a, aw, cursorAt } = setup()
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('첫') })
    const passes = withLayoutSpy(a)
    // 이름표가 보이는 동안의 배치 흔적(fitTags 가 단 것)을 흉내 — 꺼지면 다음 배치가 지워야 한다.
    const el = cursors(a)[0]
    el.classList.add('wiki-presence-cursor--flip')
    el.style.setProperty('--wiki-tag-stack', '1')
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    expect(el.hasAttribute('data-label-visible')).toBe(false)
    vi.advanceTimersToNextFrame()
    expect(passes()).toBe(1)
    expect(el.classList.contains('wiki-presence-cursor--flip')).toBe(false)
    expect(el.style.getPropertyValue('--wiki-tag-stack')).toBe('')
  })

  it('runs a single pass when one transaction moves both ✦ and a cursor, and a cursor-only move still refits', () => {
    vi.useFakeTimers()
    const { a, b, aw, cursorAt } = setup({ current: false }, true)
    aw.set(4242, { aiMarkers: [{ id: 'm', userId: 3, name: '이영희', anchor: cursorAt('둘째').head }] })
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('둘째') })
    expect(a.view.dom.querySelectorAll('.wiki-ai-marker')).toHaveLength(1)
    const passes = withLayoutSpy(a)
    // 둘 앞의 원격 편집 — 한 트랜잭션(y-prosemirror)이 ✦ 와 커서를 함께 옮긴다. 두 플러그인이 각각 요청해도 배치는 한 번.
    b.commands.insertContentAt(1, '앞 ')
    vi.advanceTimersToNextFrame()
    expect(passes()).toBe(1)
    // 커서만 움직여도 루트 전체(✦ 쌓기 칸 포함)를 다시 맞춘다.
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('첫') })
    vi.advanceTimersToNextFrame()
    expect(passes()).toBe(2)
  })
})

describe('WikiPresenceCursors — 문단 중간 타이핑(seq)', () => {
  it('shows the label when a peer types mid-paragraph (same anchor JSON, new seq)', () => {
    vi.useFakeTimers()
    const { a, aw, cursorAt } = setup()
    const cur = cursorAt('째')
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: { ...cur, seq: 1 } })
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
    // 캐럿 오른쪽 글자가 그대로라 상대 위치 JSON 은 같고 활동 횟수만 오른다 — 움직임이다.
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: { ...cur, seq: 2 } })
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(true)
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
    // 같은 seq 재전송(15초 갱신)은 움직임이 아니다.
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: { ...cur, seq: 2 } })
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
  })

  it('bumps my published seq for my own typing (at most once per SEQ_PUBLISH_MS) but not for remote edits', () => {
    vi.useFakeTimers()
    const { a, b, aw } = setup()
    vi.spyOn(a.view, 'hasFocus').mockReturnValue(true)
    const local = () => aw.getLocalState()?.cursor as { anchor: object; seq?: number } | null
    a.commands.setTextSelection(startOf(a, '째'))
    const first = local()!
    expect(typeof first.seq).toBe('number')
    // 문단 중간 타이핑 — anchor JSON 은 같아도 활동이라 seq 가 오른다(바로 또는 SEQ_PUBLISH_MS 안에 한 번).
    a.commands.insertContent('가')
    a.commands.insertContent('나')
    vi.advanceTimersByTime(SEQ_PUBLISH_MS)
    const typed = local()!
    expect(JSON.stringify(typed.anchor)).toBe(JSON.stringify(first.anchor))
    expect(typed.seq!).toBeGreaterThan(first.seq!)
    // 다른 사람의 편집(내 캐럿 앞)은 내 활동이 아니다 — seq 는 그대로.
    b.commands.insertContentAt(1, '앞 ')
    vi.advanceTimersByTime(SEQ_PUBLISH_MS)
    expect(local()!.seq).toBe(typed.seq)
  })
})

describe('WikiPresenceCursors — 내 편집에 삼켜진 캐럿', () => {
  it('keeps an idle remote caret at the deletion point and does not flash its label when it re-resolves there', () => {
    vi.useFakeTimers()
    const { a, aw } = setup()
    const inside = startOf(a, '둘째') + 1 // "둘|째"
    const relAtPos = (pos: number) => Y.relativePositionToJSON(toRelative(a.state, pos)!)
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: { anchor: relAtPos(inside), head: relAtPos(inside) } })
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
    // 내 삭제가 캐럿을 감싼다 — 버리지 않고 지운 자리로 옮긴다(상대가 움직인 것이 아니라 이름표는 그대로 꺼져 있다).
    const from = startOf(a, '둘째')
    a.commands.deleteRange({ from, to: from + 2 })
    expect(positions(a)).toEqual([from])
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
    // 상대 화면이 내 삭제를 받아 같은 자리의 새 상대 위치를 다시 알린다 — 같은 자리라 움직임이 아니다.
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: { anchor: relAtPos(from), head: relAtPos(from) } })
    expect(positions(a)).toEqual([from])
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
  })
})

describe('WikiPresenceCursors — hover', () => {
  /** jsdom 은 레이아웃이 없다 — 캐럿만 (100, 50~70) 에 있다고 심는다. */
  function stubCaretRect() {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const caret = this.classList.contains('wiki-presence-cursor__caret')
      return (caret
        ? { left: 99, right: 101, width: 2, top: 50, bottom: 70, height: 20, x: 99, y: 50 }
        : { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0 }) as DOMRect
    })
  }
  const move = (e: Editor, x: number, y: number) =>
    e.view.dom.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: x, clientY: y, bubbles: true }))
  const caretReads = (spy: ReturnType<typeof stubCaretRect>) =>
    spy.mock.contexts.filter((el) => (el as HTMLElement).classList.contains('wiki-presence-cursor__caret')).length

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the label while the pointer stays over the caret and hides it LABEL_SHOW_MS after leaving', () => {
    vi.useFakeTimers()
    const rect = stubCaretRect()
    const { a, aw, cursorAt } = setup()
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('첫') })
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
    rect.mockClear()
    // 한 프레임 안의 여러 움직임은 판정 한 번.
    move(a, 101, 60)
    move(a, 100, 61)
    move(a, 102, 62)
    vi.advanceTimersToNextFrame()
    expect(caretReads(rect)).toBe(1)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(true)
    // 멈춘 채 올려 두면 계속 보인다.
    vi.advanceTimersByTime(LABEL_SHOW_MS * 3)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(true)
    // 벗어나면 그때부터 3초.
    move(a, 400, 60)
    vi.advanceTimersToNextFrame()
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(true)
    vi.advanceTimersByTime(LABEL_SHOW_MS)
    expect(cursors(a)[0].hasAttribute('data-label-visible')).toBe(false)
  })

  it('skips the hit test when there are no remote cursors', () => {
    vi.useFakeTimers()
    const rect = stubCaretRect()
    const { a } = setup()
    const query = vi.spyOn(a.view.dom, 'querySelectorAll')
    move(a, 101, 60)
    vi.advanceTimersToNextFrame()
    expect(query).not.toHaveBeenCalled()
    expect(caretReads(rect)).toBe(0)
  })
})

describe('WikiPresenceCursors — 접근성', () => {
  it('hides the cursor widget from assistive tech (the presence list is the accessible path)', () => {
    const { a, aw, cursorAt } = setup()
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('둘째') })
    const [el] = cursors(a)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('aria-label')).toBe(false)
  })
})

describe('WikiPresenceCursors — 내 커서 공개', () => {
  it('clears my published cursor when hidden (terminal)', () => {
    const hiddenRef = { current: false }
    const { a, aw } = setup(hiddenRef)
    vi.spyOn(a.view, 'hasFocus').mockReturnValue(true)
    a.commands.setTextSelection(startOf(a, '둘째'))
    expect(aw.getLocalState()?.cursor).not.toBeNull()
    hiddenRef.current = true
    a.view.dispatch(a.state.tr.setMeta(wikiPresenceCursorsKey, true))
    expect(aw.getLocalState()?.cursor).toBeNull()
  })

  it('on destroy clears my cursor, its timers and its awareness listener', () => {
    vi.useFakeTimers()
    const { a, aw, cursorAt } = setup()
    const off = vi.spyOn(aw, 'off')
    vi.spyOn(a.view, 'hasFocus').mockReturnValue(true)
    // 에디터·Yjs 바인딩이 따로 거는 타이머는 빼고, 이 확장이 건 것(이름표 시계·배치 프레임)만 센다.
    const baseline = vi.getTimerCount()
    aw.set(500, { user: { id: 2, name: '김철수' }, cursor: cursorAt('첫') }) // 이름표 타이머 + 배치 프레임 예약
    a.commands.setTextSelection(startOf(a, '둘째'))
    expect(aw.getLocalState()?.cursor).not.toBeNull()
    expect(vi.getTimerCount()).toBeGreaterThan(baseline)
    a.destroy()
    expect(aw.getLocalState()?.cursor).toBeNull()
    expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline)
    expect(off).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('publishes my cursor only while editable and focused, and clears it otherwise', () => {
    const { a, aw } = setup()
    const local = () => aw.getLocalState()?.cursor ?? null
    vi.spyOn(a.view, 'hasFocus').mockReturnValue(true)
    a.commands.setTextSelection(startOf(a, '둘째'))
    expect(local()).not.toBeNull()
    expect(aw.getLocalState()?.user).toEqual({ id: 1, name: '나' })
    a.setEditable(false)
    expect(local()).toBeNull()
    a.commands.setTextSelection(startOf(a, '첫'))
    expect(local()).toBeNull()
  })

  it('does not revive a state the provider removed (pagehide)', () => {
    const { a, aw } = setup()
    vi.spyOn(a.view, 'hasFocus').mockReturnValue(true)
    aw.set(aw.clientID, null)
    a.commands.setTextSelection(startOf(a, '둘째'))
    expect(aw.getLocalState()).toBeNull()
  })
})
