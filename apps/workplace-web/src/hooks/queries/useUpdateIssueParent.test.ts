// 부모 변경 뒤 캐시 무효화 범위(WP-1039) — 자식 프로젝트는 상세·검색을 통째로, 다른 프로젝트 에픽(이전·새 부모)은 그 에픽의 상세·하위 목록만 갱신한다.
// 상위 에픽 고르기(useUpdateIssueParent)와 에픽 드래그·되돌리기(useMoveIssueEpic)가 같은 함수를 쓴다.
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'

import { invalidateParentChange } from './useUpdateIssueParent'

/** 무효화된 쿼리 키 접두를 모은다. */
function invalidated(parents: Parameters<typeof invalidateParentChange>[2]) {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  invalidateParentChange(qc, 'WP', parents)
  return spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey)
}

describe('invalidateParentChange', () => {
  test('다른 프로젝트 에픽 → 같은 프로젝트 에픽으로 옮기면 이전 부모 에픽(PLAN-3)의 상세·하위 목록만 더 무효화한다', () => {
    expect(invalidated([{ number: 3, projectKey: 'PLAN' }, { number: 5 }])).toEqual([
      ['issues', 'WP', 'detail'],
      ['issues', 'search', 'WP'],
      ['issues', 'PLAN', 'detail', 3],
      ['issues', 'search', 'PLAN', 'children', 3],
    ])
  })

  test('새 부모가 다른 프로젝트 에픽이면 그 에픽도, 같은 프로젝트끼리면 자식 프로젝트만', () => {
    expect(invalidated([null, { projectKey: 'OPS', number: 7 }])).toEqual([
      ['issues', 'WP', 'detail'],
      ['issues', 'search', 'WP'],
      ['issues', 'OPS', 'detail', 7],
      ['issues', 'search', 'OPS', 'children', 7],
    ])
    expect(invalidated([{ number: 1 }, { number: 2, projectKey: 'WP' }])).toEqual([
      ['issues', 'WP', 'detail'],
      ['issues', 'search', 'WP'],
    ])
  })

  test('가려진 이전 부모는 프로젝트를 몰라 건너뛴다', () => {
    expect(invalidated([{ number: 0, hidden: true }, null])).toEqual([
      ['issues', 'WP', 'detail'],
      ['issues', 'search', 'WP'],
    ])
  })
})
