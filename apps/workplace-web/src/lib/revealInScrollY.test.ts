import { describe, expect, it } from 'vitest'

import { revealInScrollY } from './revealInScrollY'

/** 보이는 높이 [100, 500] 인 영역과, 주어진 위치의 행. */
const area = (scrollTop = 0) => ({ scrollTop, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) })
const item = (top: number, bottom: number) => ({ getBoundingClientRect: () => ({ top, bottom }) })

describe('revealInScrollY', () => {
  it('위로 잘린 행은 행 윗변이 영역 윗변에 닿게 올린다', () => {
    const c = area(300)
    revealInScrollY(c, item(60, 90))
    expect(c.scrollTop).toBe(260)
  })

  it('아래로 잘린 행은 행 아랫변이 영역 아랫변에 닿게 내린다', () => {
    const c = area()
    revealInScrollY(c, item(520, 560))
    expect(c.scrollTop).toBe(60)
  })

  it('이미 다 보이는 행이면 그대로 둔다', () => {
    const c = area(120)
    revealInScrollY(c, item(200, 230))
    expect(c.scrollTop).toBe(120)
  })
})
