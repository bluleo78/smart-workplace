// @vitest-environment jsdom
// 글 편집 칸 판정(WP-1374) — 개인 작업 상세 모달은 이 칸들의 Esc 만 「편집 취소」로 보고 모달 닫기를 막는다.
import { describe, expect, it } from 'vitest'

import { isTextEntryTarget } from './escapeOverlay'

/** type 을 단 input. */
function input(type: string): HTMLInputElement {
  const el = document.createElement('input')
  el.type = type
  return el
}

describe('isTextEntryTarget', () => {
  it('글자를 쳐 넣는 input(text·search·email·url·tel·password·number)·type 없는 input·textarea 는 편집 칸이다', () => {
    for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number']) {
      expect(isTextEntryTarget(input(type)), type).toBe(true)
    }
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true)
  })

  it('contentEditable 요소는 편집 칸이다', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    // jsdom 은 isContentEditable 을 계산하지 않는다 — 브라우저와 같은 값을 직접 준다.
    Object.defineProperty(el, 'isContentEditable', { value: true })
    expect(isTextEntryTarget(el)).toBe(true)
  })

  it('체크박스·라디오·날짜·시각·색·범위·파일 input 과 select·버튼·문서는 편집 칸이 아니다(Esc 가 모달을 닫는다)', () => {
    for (const type of ['checkbox', 'radio', 'date', 'datetime-local', 'time', 'color', 'range', 'file']) {
      expect(isTextEntryTarget(input(type)), type).toBe(false)
    }
    expect(isTextEntryTarget(document.createElement('select'))).toBe(false)
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false)
    expect(isTextEntryTarget(document)).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
