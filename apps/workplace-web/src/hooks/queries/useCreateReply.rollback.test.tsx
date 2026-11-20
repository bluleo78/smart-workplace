// 답글 전송 실패·성공 시 낙관 답글 정리(WP-1860·1872) — 실패하면 그 전송의 임시 답글만 걷고(스냅숏 복원 X),
// 임시 답글이 사라진 뒤 성공해도 저장 답글이 목록에 한 번만 들어가며, 캐시 없이 보냈다면 목록을 다시 부른다.
// (useCreateReply.test.ts 는 node 환경이라 renderHook 이 불가 — 훅을 렌더하는 이 테스트는 .tsx 로 분리.)
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessagePage, MessageResponse } from '../../types/messaging'
import { messagingKeys } from './messagingKeys'
import { useCreateReply } from './useCreateReply'

const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }))
vi.mock('../../api/messaging', () => ({ messagingApi: { createMessage } }))
vi.mock('../../lib/api-error', () => ({ handleApiError: vi.fn() }))

const CH = 504
const PARENT = 9500
const ME = { id: 1, name: '나', kind: 'HUMAN' as const }

function msg(over: Partial<MessageResponse>): MessageResponse {
  return {
    id: 9501, channelId: CH, authorId: 2, authorName: '남', authorKind: 'HUMAN',
    body: '기존 답글', mentions: [], parentMessageId: PARENT, replyCount: 0, unreadReplyCount: 0, followed: false,
    reactions: [], attachments: [], driveLinks: [], createdAt: '2026-06-06T03:00:00Z', editedAt: null, deleted: false,
    ...over,
  }
}

const threadItems = (qc: QueryClient) =>
  qc.getQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(PARENT))?.pages.flatMap((p) => p.items) ?? []

async function failOnce(qc: QueryClient) {
  createMessage.mockImplementation(() => Promise.reject(new Error('fail')))
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useCreateReply(CH, PARENT, ME), { wrapper })
  await act(async () => { await result.current.mutateAsync({ body: '답글' }).catch(() => {}) })
}

describe('useCreateReply — 실패 시 낙관 답글 되돌리기', () => {
  beforeEach(() => { createMessage.mockReset() })

  it('스레드 캐시가 비어 있던 채로 실패하면 임시 답글이 남지 않는다', async () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await failOnce(qc)
    expect(threadItems(qc).filter((m) => m.id < 0)).toEqual([])
    expect(invalidate).toHaveBeenCalledTimes(1) // 캐시가 없던 실패는 서버 상태로 다시 받는다
  })

  it('캐시가 있던 실패는 임시 행만 걷고 기존 행은 그대로 둔다', async () => {
    const qc = new QueryClient()
    qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(PARENT), {
      pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    })
    await failOnce(qc)
    expect(threadItems(qc).map((m) => m.id)).toEqual([9501])
  })

  function seed(qc: QueryClient) {
    qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(PARENT), {
      pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    })
  }
  function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
  function render(qc: QueryClient) {
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    return renderHook(() => useCreateReply(CH, PARENT, ME), { wrapper })
  }

  it('연달아 보낸 둘째 답글이 성공하고 첫째만 실패하면 둘째 저장 행이 남는다', async () => {
    const a = deferred<unknown>()
    const b = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const qc = new QueryClient()
    seed(qc)
    const { result } = render(qc)
    let pa: Promise<unknown> = Promise.resolve()
    let pb: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pa = result.current.mutateAsync({ body: 'A' }).catch(() => {})
      pb = result.current.mutateAsync({ body: 'B' }).catch(() => {})
    })
    await act(async () => { b.resolve({ data: msg({ id: 9601, body: 'B' }) }); await pb })
    await act(async () => { a.reject(new Error('fail')); await pa })
    const ids = threadItems(qc).map((m) => m.id)
    expect(ids).toContain(9601)
    expect(ids).toContain(9501)
    expect(ids.filter((id) => id < 0)).toEqual([])
  })

  it('요청 중 더해진 답글이 실패 뒤에도 남는다', async () => {
    const a = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise)
    const qc = new QueryClient()
    seed(qc)
    const { result } = render(qc)
    let pa: Promise<unknown> = Promise.resolve()
    await act(async () => { pa = result.current.mutateAsync({ body: 'A' }).catch(() => {}) })
    act(() => {
      qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(PARENT), (old) => {
        const last = old!.pages[old!.pages.length - 1]
        return { ...old!, pages: [...old!.pages.slice(0, -1), { ...last, items: [...last.items, msg({ id: 9700 })] }] }
      })
    })
    await act(async () => { a.reject(new Error('fail')); await pa })
    const ids = threadItems(qc).map((m) => m.id)
    expect(ids).toContain(9700)
    expect(ids.filter((id) => id < 0)).toEqual([])
  })

  it('캐시가 있던 실패는 무효화하지 않는다', async () => {
    const qc = new QueryClient()
    seed(qc)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await failOnce(qc)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('캐시 없이 보낸 A 가 실패해 재조회가 B 의 임시 답글을 지워도 B 성공 시 저장 답글이 한 번 들어간다', async () => {
    const a = deferred<unknown>()
    const b = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const qc = new QueryClient()
    const { result } = render(qc)
    let pa: Promise<unknown> = Promise.resolve()
    let pb: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pa = result.current.mutateAsync({ body: 'A' }).catch(() => {})
      pb = result.current.mutateAsync({ body: 'B' }).catch(() => {})
    })
    await act(async () => { a.reject(new Error('fail')); await pa })
    act(() => { seed(qc) }) // 재조회 결과를 흉내 — 서버 데이터에는 B 가 아직 없다.
    await act(async () => { b.resolve({ data: msg({ id: 9601, body: 'B' }) }); await pb })
    const ids = threadItems(qc).map((m) => m.id)
    expect(ids.filter((id) => id === 9601)).toHaveLength(1)
    expect(ids).toContain(9501)
    expect(ids[ids.length - 1]).toBe(9601) // 스레드는 ASC — 끝에 들어간다
    expect(ids.filter((id) => id < 0)).toEqual([])
  })

  it('임시 답글이 사라졌고 SSE echo 가 저장 답글을 이미 넣었으면 한 행만 남는다', async () => {
    const a = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise)
    const qc = new QueryClient()
    seed(qc)
    const { result } = render(qc)
    let pa: Promise<unknown> = Promise.resolve()
    await act(async () => { pa = result.current.mutateAsync({ body: 'A' }).catch(() => {}) })
    act(() => {
      qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(PARENT), {
        pages: [{ items: [msg({}), msg({ id: 9601, body: 'A' })], nextCursor: null, hasMore: false }],
        pageParams: [undefined],
      })
    })
    await act(async () => { a.resolve({ data: msg({ id: 9601, body: 'A' }) }); await pa })
    expect(threadItems(qc).filter((m) => m.id === 9601)).toHaveLength(1)
  })

  it('캐시 없이 보낸 전송이 성공하면 목록을 다시 부르고, 캐시가 있었으면 부르지 않는다', async () => {
    createMessage.mockImplementation(() => Promise.resolve({ data: msg({ id: 9601 }) }))
    const qc1 = new QueryClient()
    const inv1 = vi.spyOn(qc1, 'invalidateQueries')
    const r1 = render(qc1)
    await act(async () => { await r1.result.current.mutateAsync({ body: 'A' }) })
    expect(inv1).toHaveBeenCalledTimes(1)
    const qc2 = new QueryClient()
    seed(qc2)
    const inv2 = vi.spyOn(qc2, 'invalidateQueries')
    const r2 = render(qc2)
    await act(async () => { await r2.result.current.mutateAsync({ body: 'A' }) })
    expect(inv2).not.toHaveBeenCalled()
  })
})
