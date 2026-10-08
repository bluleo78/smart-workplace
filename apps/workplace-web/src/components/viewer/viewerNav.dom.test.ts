// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { isControl } from './viewerNav'

/** HTML 조각을 붙이고 data-t 표식 요소를 돌려준다. */
function el(html: string): Element {
  document.body.innerHTML = html
  return document.querySelector('[data-t]')!
}

describe('isControl', () => {
  it('버튼·링크·입력·위젯 역할·label·tabindex≥0 안이면 조작 요소', () => {
    for (const html of [
      '<button><span data-t></span></button>',
      '<a href="#" data-t></a>',
      '<input data-t />',
      '<label><span data-t></span></label>',
      '<div role="tab" data-t></div>',
      '<div role="checkbox" data-t></div>',
      '<div role="switch" data-t></div>',
      '<div role="slider" data-t></div>',
      '<div role="option" data-t></div>',
      '<div role="radio" data-t></div>',
      '<div role="menuitemcheckbox" data-t></div>',
      '<div tabindex="0" data-t></div>',
    ]) {
      expect([html, isControl(el(html))]).toEqual([html, true])
    }
  })
  it('뷰어 루트(role=dialog·tabindex=-1)·미디어 요소·일반 요소는 아니다', () => {
    expect(isControl(el('<div role="dialog" tabindex="-1" data-t></div>'))).toBe(false)
    expect(isControl(el('<video data-t></video>'))).toBe(false)
    expect(isControl(el('<div><p data-t></p></div>'))).toBe(false)
  })
})
