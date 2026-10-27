// 상위 공유 제외 켜기·풀기(WP-987)가 사이드바 트리를 다시 받게 하는지(WP-1031) — 트리 행의 shareExcluded 로 이동 경고를 판단하므로
// 제외를 바꾼 직후 옮겨도 옛 값(「새로 보이게 됩니다」)으로 묻지 않아야 한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useWikiShareMutations } from './useWikiShare'
import { wikiKeys } from './wikiKeys'

vi.mock('../../api/wiki', () => ({
  wikiApi: {
    excludeFromParentShare: vi.fn(() => Promise.resolve({ data: undefined })),
    includeInParentShare: vi.fn(() => Promise.resolve({ data: undefined })),
  },
}))

const SPACE_ID = 7

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  // 상위 창의 「제외 풀기」처럼 창의 페이지(5)와 표시를 바꿀 하위(9)가 다를 수 있다 — 트리는 스페이스 단위로 다시 받는다.
  const { result } = renderHook(() => useWikiShareMutations(5, SPACE_ID), { wrapper })
  return { result, invalidate }
}

describe('useWikiShareMutations — exclusion', () => {
  it.each([true, false])('제외 %s 뒤에 그 스페이스 트리를 다시 받는다', async (excluded) => {
    const { result, invalidate } = setup()
    await act(() => result.current.exclusion.mutateAsync({ targetPageId: 9, excluded }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: wikiKeys.tree(SPACE_ID) })
  })
})
