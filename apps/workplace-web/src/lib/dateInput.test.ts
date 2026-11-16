// @vitest-environment jsdom
// 날짜 입력 공용 판정(WP-1644) — 요소가 없거나 badInput 이 아니면 false, badInput 이면 true.
import { describe, expect, it } from 'vitest'

import { setBadInput } from '@/test/dateInput'

import { isIncompleteDateInput } from './dateInput'

/** 지정한 badInput 으로 답하는 날짜 입력 요소. */
function inputWithBadInput(badInput: boolean): HTMLInputElement {
  const el = document.createElement('input')
  el.type = 'date'
  setBadInput(el, badInput)
  return el
}

describe('isIncompleteDateInput', () => {
  it('요소가 없거나 입력 요소가 아니면 false', () => {
    expect(isIncompleteDateInput(null)).toBe(false)
    expect(isIncompleteDateInput(undefined)).toBe(false)
    // 폼 라이브러리가 넘기는 ref 가 입력 요소가 아닐 수 있다(모바일 달력 칸 등).
    expect(isIncompleteDateInput({ focus: () => {} })).toBe(false)
    expect(isIncompleteDateInput(document.createElement('div'))).toBe(false)
  })

  it('badInput 이면 true', () => {
    expect(isIncompleteDateInput(inputWithBadInput(true))).toBe(true)
  })

  it('badInput 이 아니면(완전히 비움·완성된 날짜) false', () => {
    expect(isIncompleteDateInput(inputWithBadInput(false))).toBe(false)
  })
})
