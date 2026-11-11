// @vitest-environment happy-dom
// src/components/layout/scrollSnapshot.test.ts
// WP-1488: 스크롤 저장·복원 도우미 단위 테스트.
import { describe, expect, it } from 'vitest'

import { captureScroll, restoreScroll } from './scrollSnapshot'

/** root > a, b, (b > c) 구조를 만들고 a·c 에 스크롤 값을 둔다. */
function build() {
  const root = document.createElement('div')
  const a = document.createElement('div')
  const b = document.createElement('div')
  const c = document.createElement('div')
  b.appendChild(c)
  root.append(a, b)
  document.body.appendChild(root)
  a.scrollTop = 120
  c.scrollLeft = 40
  return { root, a, b, c }
}

describe('scrollSnapshot', () => {
  it('captureScroll 은 스크롤이 0 이 아닌 하위 요소만 담는다', () => {
    const { root, a, c } = build()
    const snap = captureScroll(root)
    expect(snap).toHaveLength(2)
    expect(snap.find((s) => s.el === a)).toMatchObject({ top: 120, left: 0 })
    expect(snap.find((s) => s.el === c)).toMatchObject({ top: 0, left: 40 })
  })

  it('restoreScroll 은 저장한 값을 되돌린다', () => {
    const { root, a, c } = build()
    const snap = captureScroll(root)
    a.scrollTop = 0
    c.scrollLeft = 0
    restoreScroll(snap)
    expect(a.scrollTop).toBe(120)
    expect(c.scrollLeft).toBe(40)
  })

  it('restoreScroll 은 문서에서 떨어진 요소를 건드리지 않는다', () => {
    const { root, a } = build()
    const snap = captureScroll(root)
    a.remove()
    a.scrollTop = 0
    restoreScroll(snap)
    expect(a.scrollTop).toBe(0)
  })

  it('restoreScroll 은 그 사이 페이지가 직접 옮긴 위치를 덮지 않는다', () => {
    const { root, a } = build()
    const snap = captureScroll(root)
    a.scrollTop = 900 // 같은 커밋에서 페이지가 맨 아래로 옮긴 경우
    restoreScroll(snap)
    expect(a.scrollTop).toBe(900)
  })
})
