// @vitest-environment jsdom
// 도움말 `?` 단축키 판정(WP-1505) — 글자로 쓰여야 할 때(입력 칸·IME 조합·조합 키·열린 오버레이)는 패널을 토글하지 않는다.
import { afterEach, describe, expect, it } from 'vitest'

import { isHelpShortcut } from './helpShortcut'

/** target 을 붙인 keydown 이벤트 — 실제 dispatch 없이 판정만 보므로 target 을 직접 정한다. */
function key(init: KeyboardEventInit & { target?: EventTarget; keyCode?: number }): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(e, 'target', { value: init.target ?? document.body })
  if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode })
  return e
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isHelpShortcut', () => {
  it('Shift+/ 의 ? 는 받는다', () => {
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(true)
  })

  it('? 가 아닌 키는 무시', () => {
    expect(isHelpShortcut(key({ key: '/' }))).toBe(false)
  })

  it('입력 칸·textarea·contenteditable 안은 무시', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom 은 isContentEditable 을 계산하지 않아 브라우저 값을 흉내 낸다.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    for (const target of [input, textarea, editable]) {
      expect(isHelpShortcut(key({ key: '?', shiftKey: true, target }))).toBe(false)
    }
  })

  it('IME 조합 중(isComposing, keyCode 229)은 무시', () => {
    expect(isHelpShortcut(key({ key: '?', isComposing: true }))).toBe(false)
    expect(isHelpShortcut(key({ key: '?', keyCode: 229 }))).toBe(false)
  })

  it('⌘/Ctrl/Alt 조합은 무시', () => {
    expect(isHelpShortcut(key({ key: '?', metaKey: true }))).toBe(false)
    expect(isHelpShortcut(key({ key: '?', ctrlKey: true }))).toBe(false)
    expect(isHelpShortcut(key({ key: '?', altKey: true }))).toBe(false)
  })

  it('누른 채 반복되는 keydown(repeat)은 무시 — 누르고 있는 동안 패널이 계속 여닫히지 않게', () => {
    expect(isHelpShortcut(key({ key: '?', shiftKey: true, repeat: true }))).toBe(false)
  })

  it('다른 핸들러가 이미 처리한 키는 무시', () => {
    const e = key({ key: '?' })
    e.preventDefault()
    expect(isHelpShortcut(e)).toBe(false)
  })

  it('포커스를 가두는 모달(aria-modal 대화상자·Radix 모달이 바깥을 숨긴 상태)·열린 메뉴·목록이 있으면 무시', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(false)
    // Radix 모달 대화상자는 aria-modal 을 달지 않고 바깥 형제를 숨긴다(aria-hidden 라이브러리의 data-aria-hidden 표식).
    dialog.removeAttribute('aria-modal')
    const page = document.createElement('div')
    page.setAttribute('aria-hidden', 'true')
    page.setAttribute('data-aria-hidden', 'true')
    document.body.appendChild(page)
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(false)
    page.remove()
    dialog.setAttribute('role', 'alertdialog')
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(false)
    dialog.setAttribute('role', 'menu')
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(false)
    dialog.setAttribute('role', 'listbox')
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(false)
  })

  it('툴팁이 떠 있어도 받는다 — 레일 아이콘 툴팁(Radix popper 안 role=tooltip)은 키 입력을 받지 않는다', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-radix-popper-content-wrapper', '')
    const tip = document.createElement('div')
    tip.setAttribute('role', 'tooltip')
    wrapper.appendChild(tip)
    document.body.appendChild(wrapper)
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(true)
  })

  it('AI 옆 비모달 대화상자(aria-modal 없음·바깥을 숨기지 않음)가 열려 있어도 받는다', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(true)
  })

  it('포커스가 팝오버(popper 안 대화상자) 안에 있으면 그 팝오버 몫이라 무시', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-radix-popper-content-wrapper', '')
    const popover = document.createElement('div')
    popover.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    popover.appendChild(button)
    wrapper.appendChild(popover)
    document.body.appendChild(wrapper)
    expect(isHelpShortcut(key({ key: '?', shiftKey: true, target: button }))).toBe(false)
    // 포커스가 바깥이면(비모달 팝오버) 받는다.
    expect(isHelpShortcut(key({ key: '?', shiftKey: true }))).toBe(true)
  })
})
