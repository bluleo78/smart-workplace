// 답글 전송 실패 시 낙관 답글 되돌리기(WP-1860) — 스레드 캐시 스냅샷이 없던 경우에도 임시 답글이 남지 않아야 한다.
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
    await failOnce(qc)
    expect(threadItems(qc).filter((m) => m.id < 0)).toEqual([])
  })

  it('스냅샷이 있으면 실패 시 그대로 복원한다', async () => {
    const qc = new QueryClient()
    qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(PARENT), {
      pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    })
    await failOnce(qc)
    expect(threadItems(qc).map((m) => m.id)).toEqual([9501])
  })
})
