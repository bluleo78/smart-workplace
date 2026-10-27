// 남은 페이지 끝까지 받기(WP-996) — 훅 테스트. 판정 조건과 「응답마다 다시 판정」을 렌더 타이밍과 무관하게 지킨다.
// 실제 화면 경로(그룹 보드 MSW 즉시 응답)는 src/pages/projects/groupedBoardPaging.test.tsx 가 본다.
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { useFetchAllPages } from './useFetchAllPages'

type Q = Parameters<typeof useFetchAllPages>[0]

function query(over: Partial<Q> = {}): Q {
  return {
    hasNextPage: true,
    isFetching: false,
    isFetchNextPageError: false,
    dataUpdatedAt: 1,
    fetchNextPage: vi.fn() as unknown as Q['fetchNextPage'],
    ...over,
  }
}

describe('useFetchAllPages (WP-996)', () => {
  test('더 있고 요청 중이 아니면 다음 페이지를 부른다', () => {
    const q = query()
    renderHook(() => useFetchAllPages(q))
    expect(q.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  test('요청 중 표시가 그려지지 않아도 응답(dataUpdatedAt)이 오면 다시 부른다', () => {
    const fetchNextPage = vi.fn() as unknown as Q['fetchNextPage']
    const { rerender } = renderHook((q: Q) => useFetchAllPages(q), { initialProps: query({ fetchNextPage }) })
    // 응답이 한 번 그리는 사이에 와 isFetching=true 가 그려지지 않은 경우 — 바뀐 것은 dataUpdatedAt 뿐이다.
    rerender(query({ fetchNextPage, dataUpdatedAt: 2 }))
    rerender(query({ fetchNextPage, dataUpdatedAt: 3 }))
    expect(fetchNextPage).toHaveBeenCalledTimes(3)
  })

  test('요청 중(새로 고침 포함)·더 없음·다음 페이지 실패·꺼짐이면 부르지 않는다', () => {
    for (const q of [
      query({ isFetching: true }),
      query({ hasNextPage: false }),
      query({ isFetchNextPageError: true }),
    ]) {
      renderHook(() => useFetchAllPages(q))
      expect(q.fetchNextPage).not.toHaveBeenCalled()
    }
    const off = query()
    renderHook(() => useFetchAllPages(off, false))
    expect(off.fetchNextPage).not.toHaveBeenCalled()
  })
})
