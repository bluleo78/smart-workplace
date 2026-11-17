// @vitest-environment jsdom
// 본문 편집칸(ProseMirror) 안 여부 판정(WP-1657) — 이슈 만들기 창이 Esc 를 편집칸에 넘길지 가르는 데 쓴다.
import { describe, expect, it } from 'vitest'

import { isRichBodyTarget } from './richBodyTarget'

describe('isRichBodyTarget', () => {
  it('.ProseMirror 안의 문단이면 true', () => {
    const editor = document.createElement('div')
    editor.className = 'ProseMirror'
    const p = document.createElement('p')
    editor.appendChild(p)
    expect(isRichBodyTarget(p)).toBe(true)
    expect(isRichBodyTarget(editor)).toBe(true)
  })

  it('일반 입력칸이면 false', () => {
    expect(isRichBodyTarget(document.createElement('input'))).toBe(false)
  })

  it('대상이 없으면 false', () => {
    expect(isRichBodyTarget(null)).toBe(false)
  })
})
