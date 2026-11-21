// @vitest-environment node
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { ChatMessageResponse } from '@/types/chat'

import { chatKeys } from './queries/chatKeys'
import { handleChatEvent } from './useChatStream'

// WP-1680: 이슈 챗 수정 이벤트는 수정 뒤 첨부 전체 목록을 싣는다 — 키가 있으면 통째로 바꾸고, 없으면 첨부를 건드리지 않는다.
describe('handleChatEvent — chat.message.updated 의 attachments (WP-1680)', () => {
  const page = (items: ChatMessageResponse[]) => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] })
  const att = (fileId: number) => ({
    fileId, messageId: 5, originalName: `f${fileId}.pdf`, mimeType: 'application/pdf', sizeBytes: 1,
    attachedById: 1, attachedByName: 'me', attachedAt: '2026-11-17T00:00:00Z',
  })
  const cached = () => ({ id: 5, threadId: 100, body: '옛', attachments: [att(1), att(2)] }) as unknown as ChatMessageResponse
  const itemOf = (qc: QueryClient) =>
    qc.getQueryData<{ pages: { items: ChatMessageResponse[] }[] }>(chatKeys.messages(100))!.pages[0].items[0]

  it('attachments 키가 있으면 첨부를 통째로 바꾼다(빈 배열 포함)', () => {
    const qc = new QueryClient()
    qc.setQueryData(chatKeys.messages(100), page([cached()]))
    handleChatEvent(qc, 'chat.message.updated', { threadId: 100, id: 5, body: '새', mentions: [], editedAt: 'x', attachments: [att(1)] })
    expect(itemOf(qc).attachments.map((a) => a.fileId)).toEqual([1])
    expect(itemOf(qc).body).toBe('새')
    handleChatEvent(qc, 'chat.message.updated', { threadId: 100, id: 5, body: '새', mentions: [], editedAt: 'x', attachments: [] })
    expect(itemOf(qc).attachments).toEqual([])
  })

  it('attachments 키가 없으면 첨부를 건드리지 않고 본문만 바꾼다', () => {
    const qc = new QueryClient()
    qc.setQueryData(chatKeys.messages(100), page([cached()]))
    handleChatEvent(qc, 'chat.message.updated', { threadId: 100, id: 5, body: '새', mentions: [], editedAt: 'x' })
    expect(itemOf(qc).body).toBe('새')
    expect(itemOf(qc).attachments.map((a) => a.fileId)).toEqual([1, 2])
  })
})

// WP-1914: 서랍이 닫혀 messages 캐시가 없을 때 받은 이벤트는 스레드 캐시 recentMessages(서랍이 열릴 때의 시드)에 반영한다.
// 이슈 챗 메시지 응답 — 테스트에 필요한 필드만.
const m = (id: number) => ({ id, threadId: 100, authorId: 2, body: `b${id}`, deleted: false }) as ChatMessageResponse

describe('handleChatEvent — 스레드 캐시 recentMessages 반영 (WP-1914, 서랍은 열 때 이것으로 시드)', () => {
  const thread = (threadId: number, recentMessages: unknown) =>
    ({ threadId, issueId: 1, archivedAt: null, members: [], recentMessages })
  const recentOf = (qc: QueryClient, issueNumber = 7) =>
    qc.getQueryData<{ recentMessages: ChatMessageResponse[] }>(chatKeys.thread('WP', issueNumber))!.recentMessages
  const seeded = () => {
    const qc = new QueryClient()
    qc.setQueryData(chatKeys.thread('WP', 7), thread(100, [m(1)]))
    return qc
  }

  it('created 를 받으면 recentMessages 맨 앞에 넣는다', () => {
    const qc = seeded()
    handleChatEvent(qc, 'chat.message.created', m(2))
    expect(recentOf(qc).map((x) => x.id)).toEqual([2, 1])
  })

  it('같은 id 의 created 를 두 번 받아도 한 번만 들어간다', () => {
    const qc = seeded()
    handleChatEvent(qc, 'chat.message.created', m(2))
    handleChatEvent(qc, 'chat.message.created', { ...m(2), body: '바뀜' })
    expect(recentOf(qc).map((x) => x.id)).toEqual([2, 1])
    expect(recentOf(qc)[0].body).toBe('바뀜')
  })

  it('updated·deleted·options 는 그 항목을 고친다', () => {
    const qc = seeded()
    handleChatEvent(qc, 'chat.message.updated', { threadId: 100, id: 1, body: '새', mentions: [], editedAt: 'x' })
    expect(recentOf(qc)[0].body).toBe('새')
    handleChatEvent(qc, 'chat.message.deleted', { threadId: 100, id: 1 })
    expect(recentOf(qc)[0].deleted).toBe(true)
    handleChatEvent(qc, 'chat.message.options', { threadId: 100, messageId: 1, options: ['a', 'b'] })
    expect(recentOf(qc)[0].options).toEqual(['a', 'b'])
  })

  it('다른 스레드 캐시는 그대로다', () => {
    const qc = seeded()
    qc.setQueryData(chatKeys.thread('WP', 8), thread(200, [{ ...m(1), threadId: 200 }]))
    const before = recentOf(qc, 8)
    handleChatEvent(qc, 'chat.message.created', m(2))
    expect(recentOf(qc, 8)).toBe(before)
  })

  it('messages 캐시가 있어도 스레드 캐시를 함께 고친다(gcTime 뒤 다시 시드될 때 빠지지 않게)', () => {
    const qc = seeded()
    qc.setQueryData(chatKeys.messages(100), { pages: [{ items: [m(1)], nextCursor: null, hasMore: false }], pageParams: [null] })
    handleChatEvent(qc, 'chat.message.created', m(2))
    const first = qc.getQueryData<{ pages: { items: ChatMessageResponse[] }[] }>(chatKeys.messages(100))!.pages[0].items
    expect(first.map((x) => x.id)).toEqual([2, 1])
    expect(recentOf(qc).map((x) => x.id)).toEqual([2, 1])
  })

  it('스레드 캐시를 고쳐도 dataUpdatedAt(신선도)은 그대로다', () => {
    const qc = seeded()
    const before = qc.getQueryState(chatKeys.thread('WP', 7))!.dataUpdatedAt
    vi.useFakeTimers()
    try {
      vi.setSystemTime(before + 60_000)
      handleChatEvent(qc, 'chat.message.created', m(2))
    } finally {
      vi.useRealTimers()
    }
    expect(recentOf(qc).map((x) => x.id)).toEqual([2, 1])
    expect(qc.getQueryState(chatKeys.thread('WP', 7))!.dataUpdatedAt).toBe(before)
  })

  it('무효화된 스레드 쿼리도 고치되 무효화 표시(다음 refetch)는 남긴다', async () => {
    const qc = seeded()
    await qc.invalidateQueries({ queryKey: chatKeys.thread('WP', 7), refetchType: 'none' })
    handleChatEvent(qc, 'chat.message.created', m(2))
    expect(recentOf(qc).map((x) => x.id)).toEqual([2, 1])
    await vi.waitFor(() => expect(qc.getQueryState(chatKeys.thread('WP', 7))!.isInvalidated).toBe(true))
  })

  it('가져오는 중에 받은 created 는 응답(이벤트 전 내용)이 덮어도 응답 뒤 다시 들어간다', async () => {
    const qc = seeded()
    let resolve!: (v: unknown) => void
    const fetching = qc.fetchQuery({
      queryKey: chatKeys.thread('WP', 7),
      queryFn: () => new Promise((r) => { resolve = r }),
      staleTime: 0,
    })
    handleChatEvent(qc, 'chat.message.created', m(2))
    resolve(thread(100, [m(1)]))
    await fetching
    await vi.waitFor(() => expect(recentOf(qc).map((x) => x.id)).toEqual([2, 1]))
  })

  it('첫 가져오기 중(아직 data 없음)에 받은 created 도 응답 뒤 들어간다(리뷰 후속)', async () => {
    const qc = new QueryClient()
    let resolve!: (v: unknown) => void
    const fetching = qc.fetchQuery({
      queryKey: chatKeys.thread('WP', 7),
      queryFn: () => new Promise((r) => { resolve = r }),
    })
    handleChatEvent(qc, 'chat.message.created', m(2))
    // 응답이 이벤트보다 먼저 만들어졌다 — 그 메시지가 빠진 recentMessages.
    resolve(thread(100, [m(1)]))
    await fetching
    await vi.waitFor(() => expect(recentOf(qc).map((x) => x.id)).toEqual([2, 1]))
  })

  it('첫 가져오기 중에 받은 created 는 다른 스레드 응답에는 들어가지 않는다', async () => {
    const qc = new QueryClient()
    let resolve!: (v: unknown) => void
    const fetching = qc.fetchQuery({
      queryKey: chatKeys.thread('WP', 7),
      queryFn: () => new Promise((r) => { resolve = r }),
    })
    handleChatEvent(qc, 'chat.message.created', m(2))
    resolve(thread(999, [m(1)]))
    await fetching
    await new Promise((r) => setTimeout(r, 0))
    expect(recentOf(qc).map((x) => x.id)).toEqual([1])
  })

  it('늦게 받은 옛 created 는 맨 앞이 아니라 id 순서 자리에 들어간다(리뷰 후속)', () => {
    const qc = new QueryClient()
    qc.setQueryData(chatKeys.thread('WP', 7), thread(100, [m(5), m(3)]))
    handleChatEvent(qc, 'chat.message.created', m(4))
    expect(recentOf(qc).map((x) => x.id)).toEqual([5, 4, 3])
  })

  it('담긴 메시지보다 모두 오래된 created 는 넣지 않는다(더 옛 페이지에서 두 번 보이지 않게)', () => {
    const qc = new QueryClient()
    qc.setQueryData(chatKeys.thread('WP', 7), thread(100, [m(5), m(3)]))
    handleChatEvent(qc, 'chat.message.created', m(1))
    expect(recentOf(qc).map((x) => x.id)).toEqual([5, 3])
  })

  it('보내는 중인 내 메시지(음수 임시 id)는 맨 위에 두고 그 아래 id 순서 자리에 넣는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(chatKeys.messages(100), {
      pages: [{ items: [m(-123), m(50), m(48)], nextCursor: null, hasMore: false }],
      pageParams: [null],
    })
    handleChatEvent(qc, 'chat.message.created', m(49))
    const items = qc.getQueryData<{ pages: { items: ChatMessageResponse[] }[] }>(chatKeys.messages(100))!.pages[0].items
    expect(items.map((x) => x.id)).toEqual([-123, 50, 49, 48])
  })

  it('스레드 캐시가 없어도 예외 없이 지나간다', () => {
    const qc = new QueryClient()
    expect(() => handleChatEvent(qc, 'chat.message.created', m(2))).not.toThrow()
  })

  it('recentMessages 가 배열이 아니면 건드리지 않는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(chatKeys.thread('WP', 7), thread(100, undefined))
    handleChatEvent(qc, 'chat.message.created', m(2))
    expect(qc.getQueryData<{ recentMessages: unknown }>(chatKeys.thread('WP', 7))!.recentMessages).toBeUndefined()
  })
})

describe('handleChatEvent — messages 캐시 여러 페이지의 created 재수신', () => {

  it('messages 캐시가 두 페이지일 때 이미 있는 created 재수신은 다른 페이지에 복제하지 않는다', () => {
    const qc = new QueryClient()
    const p1 = { items: [m(3)], nextCursor: 'c', hasMore: true }
    const p2 = { items: [m(2)], nextCursor: null, hasMore: false }
    qc.setQueryData(chatKeys.messages(100), { pages: [p1, p2], pageParams: [null, 'c'] })
    handleChatEvent(qc, 'chat.message.created', { ...m(2), body: '재수신' })
    const pages = qc.getQueryData<{ pages: { items: ChatMessageResponse[] }[] }>(chatKeys.messages(100))!.pages
    expect(pages[0].items.map((x) => x.id)).toEqual([3])
    expect(pages[1].items.map((x) => x.id)).toEqual([2])
    expect(pages[1].items[0].body).toBe('재수신')
  })
})
