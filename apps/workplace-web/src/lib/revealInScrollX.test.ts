import { describe, expect, it } from 'vitest'

import { revealInScrollX } from './revealInScrollX'

/** 보이는 폭 [0, 300] 인 줄과, 주어진 위치의 칩. */
const row = (scrollLeft = 0) => ({ scrollLeft, getBoundingClientRect: () => ({ left: 0, right: 300 }) })
const chip = (left: number, right: number) => ({ getBoundingClientRect: () => ({ left, right }) })

describe('revealInScrollX', () => {
  it('오른쪽 밖에 걸친 칩은 줄을 오른쪽으로 굴려 여유까지 보이게 한다', () => {
    const c = row()
    revealInScrollX(c, chip(320, 400))
    expect(c.scrollLeft).toBe(116)
  })

  it('왼쪽 밖에 걸친 칩은 줄을 왼쪽으로 굴린다', () => {
    const c = row(200)
    revealInScrollX(c, chip(-50, 30))
    expect(c.scrollLeft).toBe(134)
  })

  it('이미 다 보이는 칩이면 그대로 둔다', () => {
    const c = row(40)
    revealInScrollX(c, chip(10, 290))
    expect(c.scrollLeft).toBe(40)
  })
})
