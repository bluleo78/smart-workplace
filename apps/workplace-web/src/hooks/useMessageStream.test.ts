import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { MessageResponse } from '../types/messaging'
import { messagingKeys } from './queries/messagingKeys'
import { handleMessagingEvent } from './useMessageStream'

// WP-135: 목록 행이 마지막 메시지 미리보기를 보여 주므로, 수정·삭제도 채널·DM 목록을 다시 불러와야 한다.
describe('handleMessagingEvent — 목록 미리보기 갱신', () => {
  for (const ev of ['messaging.message.updated', 'messaging.message.deleted']) {
    it(`${ev} 는 채널·DM 목록을 invalidate 한다`, () => {
      const qc = new QueryClient()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      handleMessagingEvent(qc, ev, { channelId: 1, id: 5, body: 'x', mentions: [], editedAt: null }, 1)
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
      expect(keys).toContain(JSON.stringify(messagingKeys.channels()))
      expect(keys).toContain(JSON.stringify(messagingKeys.dms()))
    })
  }
})

// WP-874: 서버가 비동기로 가져온(또는 작성자가 지운) 링크 미리보기를 채널·스레드 캐시의 그 메시지에 바꿔 넣는다.
describe('handleMessagingEvent — messaging.message.link-previews', () => {
  const page = (items: MessageResponse[]) => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] })
  const msg = (id: number) => ({ id, channelId: 1, linkPreviews: [] }) as unknown as MessageResponse
  const preview = { position: 0, url: 'https://a.com', title: 'A', description: null, siteName: null, hasImage: false }

  it('채널 캐시와 스레드 캐시의 같은 id 메시지만 교체한다', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.messages(1), page([msg(5), msg(6)]))
    qc.setQueryData(messagingKeys.thread(9), page([msg(5)]))
    handleMessagingEvent(qc, 'messaging.message.link-previews', { channelId: 1, id: 5, linkPreviews: [preview] }, 1)
    const ch = qc.getQueryData<{ pages: { items: MessageResponse[] }[] }>(messagingKeys.messages(1))!
    expect(ch.pages[0].items[0].linkPreviews).toEqual([preview])
    expect(ch.pages[0].items[1].linkPreviews).toEqual([])
    const th = qc.getQueryData<{ pages: { items: MessageResponse[] }[] }>(messagingKeys.thread(9))!
    expect(th.pages[0].items[0].linkPreviews).toEqual([preview])
  })

  it('빈 배열(지우기)도 그대로 반영한다', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.messages(1), page([{ ...msg(5), linkPreviews: [preview] }]))
    handleMessagingEvent(qc, 'messaging.message.link-previews', { channelId: 1, id: 5, linkPreviews: [] }, 1)
    const ch = qc.getQueryData<{ pages: { items: MessageResponse[] }[] }>(messagingKeys.messages(1))!
    expect(ch.pages[0].items[0].linkPreviews).toEqual([])
  })
})

