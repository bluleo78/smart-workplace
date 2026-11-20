// useDeleteExternalContact — 지운 상세의 재조회가 진행 중일 때 삭제해도(수정 직후 삭제) 무효화 표시가 남는지(WP-1867 리뷰 후속).
// 표시가 지워지면 지운 연락처가 신선한 캐시로 남아 옛 링크로 다시 열 때 404 안내 대신 옛 내용이 보인다.
// 화면이 구독 중인 경우(삭제 뒤 상세 GET 0건)는 pages/contacts/contactsPage.test.tsx 가 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { contactsApi } from '../../api/contacts'
import { contactKeys } from './contactKeys'
import { useDeleteExternalContact } from './useExternalContactMutations'

const ID = 100
const OLD = { id: ID, name: '옛 내용' }

describe('useDeleteExternalContact — 진행 중 재조회와 겹친 삭제', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(contactsApi, 'deleteExternal').mockResolvedValue({ data: undefined } as never)
    vi.spyOn(toast, 'success').mockImplementation(() => 'id')
  })
  afterEach(() => {
    // 끝나지 않는 재조회·gc 타이머를 남기지 않는다.
    client.clear()
    vi.restoreAllMocks()
  })

  test('수정 뒤 재조회가 끝나기 전에 삭제해도 지운 상세는 무효화로 남고, 오류가 되지 않고, 다시 부르지 않는다', async () => {
    const detailKey = contactKeys.external(ID)
    const listKey = contactKeys.list('', 'ALL')
    client.setQueryData(detailKey, OLD)
    client.setQueryData(listKey, [OLD])
    // 수정 성공이 부른 재조회 — 응답이 오기 전에 삭제가 끝난다(끝나지 않는 요청으로 붙잡는다).
    const refetch = vi.fn(() => new Promise<never>(() => {}))
    void client.fetchQuery({ queryKey: detailKey, queryFn: refetch, staleTime: 0 }).catch(() => {})
    expect(client.getQueryState(detailKey)?.fetchStatus).toBe('fetching')

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDeleteExternalContact(), { wrapper })
    // mutateAsync 는 onSuccess(취소를 기다림)가 끝난 뒤 풀린다 — 그 뒤 상태가 최종이다.
    await act(async () => {
      await result.current.mutateAsync(ID)
    })

    const detail = client.getQueryState(detailKey)
    expect(detail?.fetchStatus).toBe('idle')
    expect(detail?.isInvalidated).toBe(true)
    expect(detail?.status).toBe('success') // 취소가 오류(CancelledError)로 남지 않는다
    expect(detail?.data).toEqual(OLD)
    expect(refetch).toHaveBeenCalledTimes(1) // 붙잡은 재조회 하나뿐 — 삭제가 상세를 다시 부르지 않는다
    // 목록 등 나머지 연락처 쿼리는 지금처럼 무효화된다.
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
  })
})
