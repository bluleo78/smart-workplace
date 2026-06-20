import { describe, expect, it } from 'vitest'

import type { MessageResponse } from '@/types/messaging'

import { shouldStartNewGroup } from './messageGrouping'

function msg(over: Partial<MessageResponse>): MessageResponse {
  return {
    id: 1, channelId: 1, authorId: 10, authorName: 'A', authorKind: 'HUMAN',
    body: 'x', mentions: [], parentMessageId: null, replyCount: 0, unreadReplyCount: 0, followed: false, reactions: [],
    attachments: [], createdAt: '2026-06-06T03:00:00', editedAt: null, deleted: false,
    ...over,
  }
}

describe('shouldStartNewGroup', () => {
  it('직전 메시지가 없으면(첫 메시지) 새 그룹', () => {
    expect(shouldStartNewGroup(null, msg({}))).toBe(true)
  })
  it('작성자가 다르면 새 그룹', () => {
    const prev = msg({ authorId: 10 })
    const curr = msg({ authorId: 20 })
    expect(shouldStartNewGroup(prev, curr)).toBe(true)
  })
  it('같은 작성자 + 5분 이내면 같은 그룹(false)', () => {
    const prev = msg({ authorId: 10, createdAt: '2026-06-06T03:00:00' })
    const curr = msg({ authorId: 10, createdAt: '2026-06-06T03:04:59' })
    expect(shouldStartNewGroup(prev, curr)).toBe(false)
  })
  it('같은 작성자라도 5분 초과 간격이면 새 그룹', () => {
    const prev = msg({ authorId: 10, createdAt: '2026-06-06T03:00:00' })
    const curr = msg({ authorId: 10, createdAt: '2026-06-06T03:05:01' })
    expect(shouldStartNewGroup(prev, curr)).toBe(true)
  })
})
