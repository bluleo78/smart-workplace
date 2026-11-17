// @vitest-environment node
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

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
