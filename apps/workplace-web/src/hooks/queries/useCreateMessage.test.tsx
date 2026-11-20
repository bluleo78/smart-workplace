// 메시지 전송 실패 시 낙관 행 되돌리기(WP-1860) — 캐시 스냅샷이 없던 경우에도 임시 행이 남지 않아야 한다.
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessagePage, MessageResponse } from '../../types/messaging'
import { messagingKeys } from './messagingKeys'
import { useCreateMessage } from './useCreateMessage'

const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }))
vi.mock('../../api/messaging', () => ({ messagingApi: { createMessage } }))
vi.mock('../../lib/api-error', () => ({ handleApiError: vi.fn() }))

const CH = 7
const ME = { id: 1, name: '나', kind: 'HUMAN' as const }

function msg(over: Partial<MessageResponse>): MessageResponse {
  return {
    id: 100, channelId: CH, authorId: 2, authorName: '남', authorKind: 'HUMAN',
    body: '기존', mentions: [], parentMessageId: null, replyCount: 0, unreadReplyCount: 0, followed: false,
    reactions: [], attachments: [], driveLinks: [], createdAt: '2026-06-06T03:00:00Z', editedAt: null, deleted: false,
    ...over,
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(() => useCreateMessage(CH, ME), { wrapper })
}

const itemsOf = (qc: QueryClient) =>
  qc.getQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH))?.pages.flatMap((p) => p.items) ?? []

describe('useCreateMessage — 실패 시 낙관 행 되돌리기', () => {
  beforeEach(() => { createMessage.mockReset() })

  it('캐시가 비어 있던 채로 실패하면 임시 행이 남지 않는다', async () => {
    createMessage.mockImplementation(() => Promise.reject(new Error('fail')))
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = setup(qc)
    await act(async () => { await result.current.mutateAsync({ body: '안녕' }).catch(() => {}) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(itemsOf(qc).filter((m) => m.id < 0)).toEqual([])
    expect(invalidate).toHaveBeenCalledTimes(1) // 캐시가 없던 실패는 서버 상태로 다시 받는다
  })

  it('캐시가 있던 실패는 임시 행만 걷고 기존 행은 그대로 둔다', async () => {
    createMessage.mockImplementation(() => Promise.reject(new Error('fail')))
    const qc = new QueryClient()
    qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH), {
      pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    })
    const { result } = setup(qc)
    await act(async () => { await result.current.mutateAsync({ body: '안녕' }).catch(() => {}) })
    expect(itemsOf(qc).map((m) => m.id)).toEqual([100])
  })

  function seed(qc: QueryClient) {
    qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH), {
      pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    })
  }

  it('연달아 보낸 둘째가 성공하고 첫째만 실패하면 둘째 저장 행이 남는다', async () => {
    const a = deferred<unknown>()
    const b = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const qc = new QueryClient()
    seed(qc)
    const { result } = setup(qc)
    let pa: Promise<unknown> = Promise.resolve()
    let pb: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pa = result.current.mutateAsync({ body: 'A' }).catch(() => {})
      pb = result.current.mutateAsync({ body: 'B' }).catch(() => {})
    })
    await act(async () => { b.resolve({ data: msg({ id: 501, body: 'B' }) }); await pb })
    await act(async () => { a.reject(new Error('fail')); await pa })
    const ids = itemsOf(qc).map((m) => m.id)
    expect(ids).toContain(501)
    expect(ids).toContain(100)
    expect(ids.filter((id) => id < 0)).toEqual([])
  })

  it('요청 중 SSE 로 더해진 메시지가 실패 뒤에도 남는다', async () => {
    const a = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise)
    const qc = new QueryClient()
    seed(qc)
    const { result } = setup(qc)
    let pa: Promise<unknown> = Promise.resolve()
    await act(async () => { pa = result.current.mutateAsync({ body: 'A' }).catch(() => {}) })
    act(() => {
      qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH), (old) => {
        const [first, ...rest] = old!.pages
        return { ...old!, pages: [{ ...first, items: [msg({ id: 900 }), ...first.items] }, ...rest] }
      })
    })
    await act(async () => { a.reject(new Error('fail')); await pa })
    const ids = itemsOf(qc).map((m) => m.id)
    expect(ids).toContain(900)
    expect(ids.filter((id) => id < 0)).toEqual([])
  })

  it('캐시가 있던 실패는 무효화하지 않는다', async () => {
    createMessage.mockImplementation(() => Promise.reject(new Error('fail')))
    const qc = new QueryClient()
    seed(qc)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = setup(qc)
    await act(async () => { await result.current.mutateAsync({ body: 'A' }).catch(() => {}) })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('캐시 없이 보낸 A 가 실패해 재조회가 B 의 임시 행을 지워도 B 성공 시 저장 행이 한 번 들어간다', async () => {
    const a = deferred<unknown>()
    const b = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const qc = new QueryClient()
    const { result } = setup(qc)
    let pa: Promise<unknown> = Promise.resolve()
    let pb: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pa = result.current.mutateAsync({ body: 'A' }).catch(() => {})
      pb = result.current.mutateAsync({ body: 'B' }).catch(() => {})
    })
    await act(async () => { a.reject(new Error('fail')); await pa })
    // 재조회 결과를 흉내 — 서버 데이터에는 B 가 아직 없다.
    act(() => {
      qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH), {
        pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
        pageParams: [undefined],
      })
    })
    await act(async () => { b.resolve({ data: msg({ id: 501, body: 'B' }) }); await pb })
    const ids = itemsOf(qc).map((m) => m.id)
    expect(ids.filter((id) => id === 501)).toHaveLength(1)
    expect(ids).toContain(100)
    expect(ids.filter((id) => id < 0)).toEqual([])
  })

  it('임시 행이 사라졌고 SSE echo 가 저장 행을 이미 넣었으면 한 행만 남는다', async () => {
    const a = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise)
    const qc = new QueryClient()
    seed(qc)
    const { result } = setup(qc)
    let pa: Promise<unknown> = Promise.resolve()
    await act(async () => { pa = result.current.mutateAsync({ body: 'A' }).catch(() => {}) })
    act(() => {
      qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH), {
        pages: [{ items: [msg({ id: 501, body: 'A' }), msg({})], nextCursor: null, hasMore: false }],
        pageParams: [undefined],
      })
    })
    await act(async () => { a.resolve({ data: msg({ id: 501, body: 'A' }) }); await pa })
    expect(itemsOf(qc).filter((m) => m.id === 501)).toHaveLength(1)
  })

  it('캐시 없이 보낸 전송이 성공하면 목록을 다시 부르고, 캐시가 있었으면 부르지 않는다', async () => {
    createMessage.mockImplementation(() => Promise.resolve({ data: msg({ id: 501 }) }))
    const qc1 = new QueryClient()
    const inv1 = vi.spyOn(qc1, 'invalidateQueries')
    const r1 = setup(qc1)
    await act(async () => { await r1.result.current.mutateAsync({ body: 'A' }) })
    expect(inv1).toHaveBeenCalledTimes(1)
    const qc2 = new QueryClient()
    seed(qc2)
    const inv2 = vi.spyOn(qc2, 'invalidateQueries')
    const r2 = setup(qc2)
    await act(async () => { await r2.result.current.mutateAsync({ body: 'A' }) })
    expect(inv2).not.toHaveBeenCalled()
  })
})
