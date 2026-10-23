// 「이동…」 위치 고르기(WP-839) — 고를 자리와 맨 아래 순서 계산.
import { describe, expect, it } from 'vitest'

import { lastChildPosition, moveTargets, subtreeIds } from './wikiMoveTargets'

// 1 회의록 ─ 2 10월 ─ 3 23일
//          └ 4 11월
// 5 설계
const page = (id: number, parentId: number | null, position: number) => ({ id, parentId, position, title: `p${id}` })
const pages = [page(1, null, 0), page(2, 1, 0), page(3, 2, 0), page(4, 1, 1), page(5, null, 1)]

describe('wikiMoveTargets', () => {
  it('subtreeIds 는 자기와 모든 하위를 모은다', () => {
    expect([...subtreeIds(pages, 1)].sort()).toEqual([1, 2, 3, 4])
    expect([...subtreeIds(pages, 3)]).toEqual([3])
  })

  it('moveTargets 는 옮길 페이지와 그 하위를 빼고 깊이 우선 순서·깊이를 지킨다', () => {
    expect(moveTargets(pages, 2).map((r) => [r.page.id, r.depth])).toEqual([
      [1, 0],
      [4, 1],
      [5, 0],
    ])
  })

  it('lastChildPosition 은 옮길 페이지를 빼고 새 부모의 자식 수를 센다', () => {
    expect(lastChildPosition(pages, 5, 1)).toBe(2) // 회의록 아래 10월·11월 다음
    expect(lastChildPosition(pages, 4, 1)).toBe(1) // 같은 부모 안에서 맨 아래로 — 자기 빼고 1
    expect(lastChildPosition(pages, 3, null)).toBe(2) // 최상위
  })
})
