import { describe, expect, it } from 'vitest'

import { revealOffset } from './viewportReveal'

const canvas = { left: 300, top: 100, right: 1140, bottom: 620 } // 840x520

describe('revealOffset', () => {
  it('캔버스 안에 완전히 들어 있으면 움직이지 않는다', () => {
    expect(revealOffset(canvas, { left: 400, top: 200, right: 700, bottom: 320 })).toEqual({ dx: 0, dy: 0 })
  })
  it('오른쪽으로만 벗어나면 그 축만 최소한 움직인다', () => {
    expect(revealOffset(canvas, { left: 1200, top: 200, right: 1400, bottom: 320 }, 8))
      .toEqual({ dx: -268, dy: 0 }) // 1140 - 8 - 1400
  })
  it('아래로만 벗어나면 y 만 움직인다', () => {
    expect(revealOffset(canvas, { left: 400, top: 700, right: 700, bottom: 820 }, 8))
      .toEqual({ dx: 0, dy: -208 }) // 620 - 8 - 820
  })
  it('두 축이 모두 벗어나면 둘 다 보정한다', () => {
    expect(revealOffset(canvas, { left: 1200, top: 700, right: 1400, bottom: 820 }, 8))
      .toEqual({ dx: -268, dy: -208 })
  })
  it('왼쪽·위쪽으로 벗어나도 같은 방식으로 돌려 놓는다', () => {
    expect(revealOffset(canvas, { left: 100, top: 20, right: 260, bottom: 90 }, 8))
      .toEqual({ dx: 208, dy: 88 })
  })
  it('캔버스가 아직 그려지지 않았으면(너비·높이 0) 움직이지 않는다', () => {
    const empty = { left: 0, top: 0, right: 0, bottom: 0 }
    expect(revealOffset(empty, { left: 10, top: 10, right: 100, bottom: 100 })).toEqual({ dx: 0, dy: 0 })
  })
  it('여백(pad) 안쪽까지는 벗어나지 않은 것으로 친다', () => {
    expect(revealOffset(canvas, { left: 1134, top: 200, right: 1400, bottom: 320 }, 8))
      .toEqual({ dx: -268, dy: 0 }) // right(1400) > 1140 - 8
    expect(revealOffset(canvas, { left: 1120, top: 200, right: 1130, bottom: 320 }, 8))
      .toEqual({ dx: 0, dy: 0 })
  })
  it('노드가 캔버스보다 넓으면 왼쪽 모서리를 캔버스에 맞춘다', () => {
    // 두 조건이 함께면 대상이 캔버스 안쪽보다 넓다 — 왼쪽을 맞춰 왼쪽 모서리가 보이게 한다.
    expect(revealOffset(canvas, { left: 200, top: 200, right: 1400, bottom: 320 }, 8))
      .toEqual({ dx: 108, dy: 0 }) // 300 + 8 - 200
  })
  it('노드가 캔버스보다 높으면 위쪽 모서리를 캔버스에 맞춘다', () => {
    expect(revealOffset(canvas, { left: 400, top: 50, right: 700, bottom: 700 }, 8))
      .toEqual({ dx: 0, dy: 58 }) // 100 + 8 - 50
  })
  it('오른쪽에만 벗어나면서 캔버스 안쪽보다 넓은 노드는 왼쪽 모서리를 맞춘다', () => {
    // 왼쪽은 안쪽인데 오른쪽만·더 넓은 노드 — 오른쪽을 맞추면 왼쪽 모서리가 잘린다(리뷰 지적 ①).
    const narrow = { left: 300, top: 100, right: 500, bottom: 620 } // 안쪽 폭 200 - 여백 16 = 184
    const offset = revealOffset(narrow, { left: 450, top: 200, right: 800, bottom: 320 }, 8)
    expect(offset).toEqual({ dx: -142, dy: 0 })
    expect(450 + offset.dx).toBe(narrow.left + 8) // 노드 왼쪽 모서리가 캔버스 여백에 맞는다
  })
  it('아래에만 벗어나면서 캔버스 안쪽보다 높은 노드는 위쪽 모서리를 맞춘다', () => {
    const offset = revealOffset(canvas, { left: 400, top: 400, right: 700, bottom: 1000 }, 8)
    expect(offset).toEqual({ dx: 0, dy: -292 })
    expect(400 + offset.dy).toBe(canvas.top + 8) // 노드 윗모서리가 캔버스 여백에 맞는다
  })
})
