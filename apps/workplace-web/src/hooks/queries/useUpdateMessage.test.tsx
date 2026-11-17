// useUpdateMessage — PATCH 응답의 낡은 linkPreviews 가 먼저 받은 미리보기 SSE 값을 덮지 않는지(WP-874).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { client } from '../../api/client'
import { messagingApi } from '../../api/messaging'
import type { LinkPreview, MessageResponse } from '../../types/messaging'
import { messagingKeys } from './messagingKeys'
import { useUpdateMessage } from './useUpdateMessage'

const fresh: LinkPreview = { position: 0, url: 'https://new.com', title: '새 링크', description: null, siteName: null, hasImage: false }
const stale: LinkPreview = { ...fresh, url: 'https://old.com', title: '옛 링크' }

afterEach(() => vi.restoreAllMocks())

describe('useUpdateMessage', () => {
  it('본문은 응답으로 바꾸고 linkPreviews 는 캐시(SSE) 값을 남긴다', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const cached = { id: 5, channelId: 1, body: '옛 본문', linkPreviews: [fresh] } as unknown as MessageResponse
    qc.setQueryData(messagingKeys.messages(1), { pages: [{ items: [cached], nextCursor: null, hasMore: false }], pageParams: [null] })
    vi.spyOn(messagingApi, 'updateMessage').mockResolvedValue({ ...cached, body: '새 본문', linkPreviews: [stale] })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useUpdateMessage(1), { wrapper })

    result.current.mutate({ messageId: 5, body: '새 본문' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const item = qc.getQueryData<{ pages: { items: MessageResponse[] }[] }>(messagingKeys.messages(1))!.pages[0].items[0]
    expect(item.body).toBe('새 본문')
    expect(item.linkPreviews).toEqual([fresh])
  })

  // WP-1679: 남길 첨부(keepFileIds)를 넘기면 PATCH 본문에 그대로 싣고, 안 넘기면 키 자체를 보내지 않는다(본문만 수정 — 지금 요청과 같은 모양).
  it('keepFileIds 를 넘기면 PATCH 본문에 그대로, 안 넘기면 키가 없다', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const saved = { id: 5, channelId: 1, body: 'x', linkPreviews: [] } as unknown as MessageResponse
    const patch = vi.spyOn(client, 'patch').mockResolvedValue({ data: saved })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useUpdateMessage(1), { wrapper })

    await result.current.mutateAsync({ messageId: 5, body: '보고서', keepFileIds: [7] })
    await result.current.mutateAsync({ messageId: 5, body: '보고서' })
    expect(patch.mock.calls[0]).toEqual(['/messaging/messages/5', { body: '보고서', keepFileIds: [7] }])
    expect(patch.mock.calls[1]).toEqual(['/messaging/messages/5', { body: '보고서' }])
    expect(patch.mock.calls[1][1]).not.toHaveProperty('keepFileIds')
  })
})
