// offset 페이징 → 무한 스크롤 공통 규칙 단위 테스트(WP-412) — 이전 E2E admin/settings-list-infinite-scroll
// (감사 로그: 경계에서 겹친 행은 한 번만)을 대체한다. 스크롤로 다음 페이지를 붙이는 배선은 구성원 목록 E2E 가 지킨다.
import { describe, expect, it } from 'vitest'

import type { PageResponse } from '../types/common'
import { flattenUniquePages, nextOffsetPage } from './offsetPaging'

const page = (n: number, ids: number[], totalPages = 2): PageResponse<{ id: number }> =>
  ({ content: ids.map((id) => ({ id })), page: n, size: 50, totalElements: 0, totalPages })

describe('flattenUniquePages', () => {
  it('페이지 경계에서 다시 온 행(새 행이 끼어 offset 이 밀림)은 한 번만, 순서는 처음 나온 자리', () => {
    expect(flattenUniquePages([page(0, [1, 2, 50]), page(1, [50, 51, 52])], (x) => x.id).map((x) => x.id)).toEqual([
      1, 2, 50, 51, 52,
    ])
  })
  it('아직 조회 전(undefined)이면 빈 목록', () => {
    expect(flattenUniquePages(undefined, (x: { id: number }) => x.id)).toEqual([])
  })
})

describe('nextOffsetPage', () => {
  it('마지막 페이지면 undefined, 아니면 다음 번호', () => {
    expect(nextOffsetPage(page(0, [], 2))).toBe(1)
    expect(nextOffsetPage(page(1, [], 2))).toBeUndefined()
    expect(nextOffsetPage(page(0, [], 0))).toBeUndefined()
  })
})
