// 이슈 챗 메시지 전송 실패 시 낙관 행 되돌리기(WP-1872) — 임시 행만 걷고, 캐시가 없던 실패는 무효화한다.
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessagePage, ChatMessageResponse } from '../../types/chat'
import { chatKeys } from './chatKeys'
import { useCreateChatMessage } from './useCreateChatMessage'

const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }))
vi.mock('../../api/chat', () => ({ chatApi: { createMessage } }))
vi.mock('../../lib/api-error', () => ({ handleApiError: vi.fn() }))

const TH = 11
const ME = { id: 1, name: '나', kind: 'HUMAN' as const }

function msg(over: Partial<ChatMessageResponse>): ChatMessageResponse {
  return {
    id: 100, threadId: TH, authorId: 2, authorName: '남', authorKind: 'HUMAN', body: '기존', mentions: [],
    attachments: [], driveLinks: [], createdAt: '2026-06-06T03:00:00Z', editedAt: null, deleted: false,
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
  return renderHook(() => useCreateChatMessage(TH, ME, []), { wrapper })
}

const itemsOf = (qc: QueryClient) =>
  qc.getQueryData<InfiniteData<ChatMessagePage>>(chatKeys.messages(TH))?.pages.flatMap((p) => p.items) ?? []

describe('useCreateChatMessage — 실패 시 낙관 행 되돌리기', () => {
  beforeEach(() => { createMessage.mockReset() })

  it('캐시 없이 실패하면 임시 행이 없고 무효화 1회', async () => {
    createMessage.mockImplementation(() => Promise.reject(new Error('fail')))
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = setup(qc)
    await act(async () => { await result.current.mutateAsync({ body: '안녕' }).catch(() => {}) })
    expect(itemsOf(qc).filter((m) => m.id < 0)).toEqual([])
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('연달아 보낸 둘째가 성공하고 첫째만 실패하면 둘째 저장 행이 남는다', async () => {
    const a = deferred<unknown>()
    const b = deferred<unknown>()
    createMessage.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const qc = new QueryClient()
    qc.setQueryData<InfiniteData<ChatMessagePage>>(chatKeys.messages(TH), {
      pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    })
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
    act(() => {
      qc.setQueryData<InfiniteData<ChatMessagePage>>(chatKeys.messages(TH), {
        pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
        pageParams: [undefined],
      })
    })
    await act(async () => { b.resolve({ data: msg({ id: 501, body: 'B' }) }); await pb })
    const ids = itemsOf(qc).map((m) => m.id)
    expect(ids.filter((id) => id === 501)).toHaveLength(1)
    expect(ids.filter((id) => id < 0)).toEqual([])
  })

  it('캐시 없이 보낸 전송이 성공하면 목록을 다시 부른다', async () => {
    createMessage.mockImplementation(() => Promise.resolve({ data: msg({ id: 501 }) }))
    const qc = new QueryClient()
    const inv = vi.spyOn(qc, 'invalidateQueries')
    const { result } = setup(qc)
    await act(async () => { await result.current.mutateAsync({ body: 'A' }) })
    expect(inv).toHaveBeenCalledTimes(1)
  })
})
