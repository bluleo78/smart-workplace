import { describe, expect, it } from 'vitest'

import { isSubmitEnter } from './submitEnter'

const key = (init: KeyboardEventInit & { keyCode?: number }) =>
  ({ shiftKey: false, isComposing: false, keyCode: 13, ...init }) as KeyboardEvent

describe('isSubmitEnter', () => {
  it('단독 Enter 는 전송', () => {
    expect(isSubmitEnter(key({ key: 'Enter' }))).toBe(true)
  })
  it('Shift+Enter 는 줄바꿈', () => {
    expect(isSubmitEnter(key({ key: 'Enter', shiftKey: true }))).toBe(false)
  })
  it('IME 조합 중(isComposing) Enter 는 무시', () => {
    expect(isSubmitEnter(key({ key: 'Enter', isComposing: true }))).toBe(false)
  })
  it('Safari 조합 확정 Enter(keyCode 229) 는 무시', () => {
    expect(isSubmitEnter(key({ key: 'Enter', keyCode: 229 }))).toBe(false)
  })
  it('다른 키는 전송 아님', () => {
    expect(isSubmitEnter(key({ key: 'a' }))).toBe(false)
  })
})
