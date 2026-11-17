import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { MessageResponse } from '../types/messaging'
import { messagingKeys } from './queries/messagingKeys'
import { handleMessagingEvent } from './useMessageStream'

// WP-135: 목록 행이 마지막 메시지 미리보기를 보여 주므로, 수정·삭제도 목록을 다시 불러와야 한다.
// 여기서는 받아 둔 목록이 없어 어느 대화인지 모르는 경우 — 두 목록을 모두 다시 받는다(종류별로 고르는 것은 WP-1663 묶음).
describe('handleMessagingEvent — 목록 미리보기 갱신', () => {
  for (const ev of ['messaging.message.updated', 'messaging.message.deleted']) {
    it(`${ev} 는 받아 둔 목록이 없으면 채널·DM 목록을 모두 invalidate 한다`, () => {
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


// WP-1176: 다른 사람의 읽음 이벤트는 받아 둔 DM 읽음 목록을 고치고, 본인 읽음은 배지(목록)만 다시 계산한다.
describe('handleMessagingEvent — messaging.message.read (DM 읽음 표시)', () => {
  const states = [{ userId: 2, name: '밥', lastReadMessageId: 10, readAt: null }]

  it('다른 사람의 읽음은 그 대화의 읽음 목록 위치·시각을 고친다', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.readStates(7), states)
    handleMessagingEvent(
      qc,
      'messaging.message.read',
      { channelId: 7, userId: 2, lastReadMessageId: 15, readAt: '2026-10-29T03:40:00Z' },
      1,
    )
    expect(qc.getQueryData(messagingKeys.readStates(7))).toEqual([
      { userId: 2, name: '밥', lastReadMessageId: 15, readAt: '2026-10-29T03:40:00Z' },
    ])
  })

  it('목록에 없던 사람이면 목록을 다시 받고, 받아 둔 목록이 없으면 건드리지 않는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.readStates(7), states)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    handleMessagingEvent(qc, 'messaging.message.read', { channelId: 7, userId: 3, lastReadMessageId: 15 }, 1)
    expect(spy).toHaveBeenCalledWith({ queryKey: messagingKeys.readStates(7), exact: true })
    spy.mockClear()
    handleMessagingEvent(qc, 'messaging.message.read', { channelId: 8, userId: 3, lastReadMessageId: 15 }, 1)
    expect(spy).not.toHaveBeenCalled()
    expect(qc.getQueryData(messagingKeys.readStates(8))).toBeUndefined()
  })

  it('DM 의 AI 참여자 읽음은 목록에 없어도 다시 받지 않는다(서버가 AI 를 빼므로 늘 없다)', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.readStates(7), states)
    qc.setQueryData(messagingKeys.dms(), [
      { id: 7, participants: [{ userId: 1, name: '나', kind: 'HUMAN' }, { userId: 2, name: '밥', kind: 'HUMAN' }, { userId: 50, name: 'AI', kind: 'AGENT' }] },
    ])
    const spy = vi.spyOn(qc, 'invalidateQueries')
    handleMessagingEvent(qc, 'messaging.message.read', { channelId: 7, userId: 50, lastReadMessageId: 15 }, 1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('본인 읽음은 읽음 목록을 건드리지 않고 채널·DM 목록만 다시 받는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.readStates(7), states)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    handleMessagingEvent(qc, 'messaging.message.read', { channelId: 7, userId: 1, lastReadMessageId: 15 }, 1)
    expect(qc.getQueryData(messagingKeys.readStates(7))).toBe(states)
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(messagingKeys.dms()))
  })
})

// WP-1663: 메시지 이벤트마다 채널·DM 목록을 모두 다시 받지 않는다 — 메시지가 속한 대화가 받아 둔 목록 중 어디에 있는지로
// 그 목록만 다시 받는다. 어느 목록에도 없으면(새 DM·막 들어간 채널·목록을 아직 안 받음) 둘 다 다시 받는다.
describe('handleMessagingEvent — 대화 종류에 맞는 목록만 다시 받기', () => {
  const channel = { id: 3, kind: 'CHANNEL', name: 'general' }
  const dm = { id: 9, participants: [], lastMessageAt: null, unreadCount: 0 }
  const setup = () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.channels(), [channel])
    qc.setQueryData(messagingKeys.dms(), [dm])
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const invalidated = () => spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    return { qc, invalidated }
  }
  const created = (channelId: number) =>
    ({ id: 100, channelId, parentMessageId: null, authorId: 2, body: 'hi' }) as unknown as MessageResponse

  it('채널 메시지 생성은 채널 목록만 다시 받는다', () => {
    const { qc, invalidated } = setup()
    handleMessagingEvent(qc, 'messaging.message.created', created(3), 1)
    expect(invalidated()).toContain(JSON.stringify(messagingKeys.channels()))
    expect(invalidated()).not.toContain(JSON.stringify(messagingKeys.dms()))
  })

  it('DM 메시지 생성은 DM 목록만 다시 받는다', () => {
    const { qc, invalidated } = setup()
    handleMessagingEvent(qc, 'messaging.message.created', created(9), 1)
    expect(invalidated()).toContain(JSON.stringify(messagingKeys.dms()))
    expect(invalidated()).not.toContain(JSON.stringify(messagingKeys.channels()))
  })

  it('어느 목록에도 없는 대화(새 DM 등)의 메시지는 두 목록을 모두 다시 받는다', () => {
    const { qc, invalidated } = setup()
    handleMessagingEvent(qc, 'messaging.message.created', created(42), 1)
    expect(invalidated()).toContain(JSON.stringify(messagingKeys.channels()))
    expect(invalidated()).toContain(JSON.stringify(messagingKeys.dms()))
  })

  it('수정·삭제·본인 읽음도 그 대화의 목록만 다시 받는다', () => {
    for (const [ev, payload] of [
      ['messaging.message.updated', { channelId: 3, id: 5, body: 'x', mentions: [], editedAt: null }],
      ['messaging.message.deleted', { channelId: 3, id: 5 }],
      ['messaging.message.read', { channelId: 3, userId: 1, lastReadMessageId: 5 }],
    ] as const) {
      const { qc, invalidated } = setup()
      handleMessagingEvent(qc, ev, payload, 1)
      expect(invalidated(), ev).toContain(JSON.stringify(messagingKeys.channels()))
      expect(invalidated(), ev).not.toContain(JSON.stringify(messagingKeys.dms()))
    }
  })
})
