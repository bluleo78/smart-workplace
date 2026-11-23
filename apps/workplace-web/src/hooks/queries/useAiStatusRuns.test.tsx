// useAiStatusRuns·useAiStatusRunDetail(WP-1825) — 「AI 현황 › 처리 이력」 데이터 계층: 필터가 쿼리 파라미터로(kind 는 반복, 빈 값은 생략)
// 나가는지, nextCursor 로 다음 페이지를 이어 받는지, 상세는 runId 가 있을 때만 부르는지를 네트워크 계층(MSW)에서 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'

import { server } from '@/test/msw/server'

import { createAiRunDetail, createAiRunItem, createAiRunPage } from '../../../e2e/factories/aiStatus.factory'
import { useAiStatusRunDetail, useAiStatusRuns } from './useAiStatusRuns'

/** 재시도 없는 QueryClient 로 감싼 wrapper. */
function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

test('kind 두 개·status·q 가 반복/단일 파라미터로 나가고 빈 값은 빠진다', async () => {
  const urls: URL[] = []
  server.use(
    http.get('/api/v1/admin/ai-status/runs', ({ request }) => {
      urls.push(new URL(request.url))
      return HttpResponse.json(createAiRunPage([createAiRunItem()]))
    }),
  )
  const { result } = renderHook(
    () =>
      useAiStatusRuns({
        kind: ['MAIL_CLASSIFY_BATCH', 'DELEGATED_WORK'],
        status: 'FAILED',
        q: '',
        from: '2026-11-22T00:00:00.000Z',
      }),
    { wrapper: makeWrapper() },
  )
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  const sp = urls[0].searchParams
  expect(sp.getAll('kind')).toEqual(['MAIL_CLASSIFY_BATCH', 'DELEGATED_WORK'])
  expect(sp.get('status')).toBe('FAILED')
  expect(sp.has('q')).toBe(false)
  expect(sp.get('from')).toBe('2026-11-22T00:00:00.000Z')
  expect(sp.get('size')).toBe('50')
  expect(sp.has('cursor')).toBe(false)
})

test('nextCursor 로 다음 페이지를 이어 받는다', async () => {
  const urls: URL[] = []
  server.use(
    http.get('/api/v1/admin/ai-status/runs', ({ request }) => {
      const url = new URL(request.url)
      urls.push(url)
      return HttpResponse.json(
        url.searchParams.get('cursor') === 'c1'
          ? createAiRunPage([createAiRunItem({ id: 'R-2' })], null)
          : createAiRunPage([createAiRunItem({ id: 'R-1' })], 'c1'),
      )
    }),
  )
  const { result } = renderHook(() => useAiStatusRuns({}), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.hasNextPage).toBe(true)
  await act(async () => {
    await result.current.fetchNextPage()
  })
  await waitFor(() => expect(result.current.data?.pages.length).toBe(2))
  expect(urls[1].searchParams.get('cursor')).toBe('c1')
  expect(result.current.hasNextPage).toBe(false)
})

test('상세는 runId 가 있을 때만 부른다', async () => {
  const paths: string[] = []
  server.use(
    http.get('/api/v1/admin/ai-status/runs/:runId', ({ request }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json(createAiRunDetail())
    }),
  )
  const wrapper = makeWrapper()
  const idle = renderHook(() => useAiStatusRunDetail(null), { wrapper })
  await new Promise((r) => setTimeout(r, 50))
  expect(paths).toHaveLength(0)
  expect(idle.result.current.fetchStatus).toBe('idle')

  const id = '0b6f0c1e-0000-4000-8000-000000000001'
  const { result } = renderHook(() => useAiStatusRunDetail(id), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(paths).toEqual(['/api/v1/admin/ai-status/runs/' + id])
})
