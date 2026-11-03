// @vitest-environment jsdom
// 상단 전체 이슈 검색(WP-1324)의 순수 판정 — 일치 강조 조각·「/」 단축키·위아래 이동.
import { describe, expect, it } from 'vitest'

import { highlightParts, isSearchableTerm, isSearchShortcut, moveActive } from './globalIssueSearchRules'

describe('highlightParts', () => {
  it('대소문자를 무시하고 맞은 곳을 모두 나눈다(원문 글자 그대로)', () => {
    expect(highlightParts('Chat 읽음 chat', 'CHAT')).toEqual([
      { text: 'Chat', match: true },
      { text: ' 읽음 ', match: false },
      { text: 'chat', match: true },
    ])
  })

  it('소문자가 되며 길이가 바뀌는 글자(İ) 뒤에서도 맞은 곳이 어긋나지 않는다, 특수문자는 글자 그대로', () => {
    expect(highlightParts('İstanbul chat', 'chat')).toEqual([
      { text: 'İstanbul ', match: false },
      { text: 'chat', match: true },
    ])
    expect(highlightParts('a.b (c)', '(c)')).toEqual([
      { text: 'a.b ', match: false },
      { text: '(c)', match: true },
    ])
  })

  it('검색어가 비었거나 맞지 않으면 통째 하나', () => {
    expect(highlightParts('읽음 표시', '  ')).toEqual([{ text: '읽음 표시', match: false }])
    expect(highlightParts('읽음 표시', '메일')).toEqual([{ text: '읽음 표시', match: false }])
  })
})

describe('isSearchShortcut', () => {
  const key = (over: Partial<KeyboardEvent> & { target?: EventTarget | null }) =>
    ({ key: '/', metaKey: false, ctrlKey: false, altKey: false, isComposing: false, defaultPrevented: false, target: document.body, ...over }) as KeyboardEvent

  it('글 입력 중이 아닐 때 수정 키 없는 「/」만 검색을 연다', () => {
    expect(isSearchShortcut(key({}))).toBe(true)
    expect(isSearchShortcut(key({ key: 'k', metaKey: true }))).toBe(false)
    expect(isSearchShortcut(key({ ctrlKey: true }))).toBe(false)
    expect(isSearchShortcut(key({ isComposing: true }))).toBe(false)
    expect(isSearchShortcut(key({ defaultPrevented: true }))).toBe(false)
  })

  it('대화상자·메뉴가 열려 있으면 열지 않는다(포커스를 오버레이가 쥐고 있다)', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    try {
      expect(isSearchShortcut(key({}))).toBe(false)
    } finally {
      dialog.remove()
    }
    expect(isSearchShortcut(key({}))).toBe(true)
  })

  it('입력칸·편집기에서 친 「/」는 글자다', () => {
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    expect(isSearchShortcut(key({ target: input }))).toBe(false)
    expect(isSearchShortcut(key({ target: document.createElement('textarea') }))).toBe(false)
    // jsdom 은 isContentEditable 을 계산하지 않아 직접 준다.
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    expect(isSearchShortcut(key({ target: editor }))).toBe(false)
  })
})

describe('moveActive', () => {
  it('처음 누르면 아래는 첫 줄·위는 끝 줄, 끝에서 처음으로 돈다', () => {
    expect(moveActive(-1, 1, 3)).toBe(0)
    expect(moveActive(-1, -1, 3)).toBe(2)
    expect(moveActive(2, 1, 3)).toBe(0)
    expect(moveActive(0, -1, 3)).toBe(2)
    expect(moveActive(0, 1, 0)).toBe(-1)
  })
})

describe('isSearchableTerm', () => {
  it('두 글자부터 보내고, 한 글자는 번호일 때만', () => {
    expect(isSearchableTerm('')).toBe(false)
    expect(isSearchableTerm('읽')).toBe(false)
    expect(isSearchableTerm('7')).toBe(true)
    expect(isSearchableTerm('#')).toBe(false)
    expect(isSearchableTerm('읽음')).toBe(true)
  })
})
