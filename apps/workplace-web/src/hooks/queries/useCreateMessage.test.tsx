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
    const { result } = setup(qc)
    await act(async () => { await result.current.mutateAsync({ body: '안녕' }).catch(() => {}) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(itemsOf(qc).filter((m) => m.id < 0)).toEqual([])
  })

  it('스냅샷이 있으면 실패 시 그대로 복원한다', async () => {
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
})
