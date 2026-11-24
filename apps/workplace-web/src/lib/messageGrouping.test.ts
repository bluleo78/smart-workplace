import { describe, expect, it } from 'vitest'

import type { MessageResponse } from '@/types/messaging'

import { shouldStartNewGroup, startsNewDay } from './messageGrouping'

function msg(over: Partial<MessageResponse>): MessageResponse {
  return {
    id: 1, channelId: 1, authorId: 10, authorName: 'A', authorKind: 'HUMAN',
    body: 'x', mentions: [], parentMessageId: null, replyCount: 0, unreadReplyCount: 0, followed: false, reactions: [],
    attachments: [], driveLinks: [], createdAt: '2026-06-06T03:00:00', editedAt: null, deleted: false,
    ...over,
  }
}

describe('shouldStartNewGroup', () => {
  it('직전 메시지가 없으면(첫 메시지) 새 그룹', () => {
    expect(shouldStartNewGroup(null, msg({}))).toBe(true)
  })
  it('같은 작성자라도 curr 시각을 읽지 못하면 새 그룹(WP-2046)', () => {
    const prev = msg({ authorId: 10 })
    const curr = msg({ authorId: 10, createdAt: 1795518215.835331 as unknown as string })
    expect(shouldStartNewGroup(prev, curr)).toBe(true)
  })
  it('같은 작성자라도 prev 시각을 읽지 못하면 새 그룹(WP-2046)', () => {
    const prev = msg({ authorId: 10, createdAt: 'not-a-date' })
    const curr = msg({ authorId: 10 })
    expect(shouldStartNewGroup(prev, curr)).toBe(true)
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

// 이전 E2E chat.spec(멀티데이 메시지 → 날짜 구분선 #338)를 대체(WP-412). 구분선 렌더 자체는 MessageList 가 이 판정만 따른다.
describe('startsNewDay', () => {
  // WP-2046: 시각을 날짜로 읽지 못한 행(예: SSE 로 epoch 숫자가 온 행)이 있어도 RangeError 로 화면 전체가 깨지지 않는다.
  it('시각을 읽지 못한 행에서는 던지지 않고 구분선을 넣지 않는다', () => {
    const ok = msg({ createdAt: '2026-06-01T01:00:00Z' })
    const bad = msg({ createdAt: 1795518215.835331 as unknown as string })
    expect(() => startsNewDay(ok, bad)).not.toThrow()
    expect(startsNewDay(ok, bad)).toBe(false)
    expect(startsNewDay(null, bad)).toBe(false)
  })
  it('직전 행 시각을 읽지 못해도 다음 정상 행 앞에는 구분선을 넣는다', () => {
    const bad = msg({ createdAt: 'not-a-date' })
    expect(startsNewDay(bad, msg({ createdAt: '2026-06-01T01:00:00Z' }))).toBe(true)
  })
  it('첫 메시지 앞에는 항상 구분선', () => {
    expect(startsNewDay(null, msg({ createdAt: '2026-06-01T01:00:00Z' }))).toBe(true)
  })
  it('같은 KST 날짜면 구분선 없음, 날짜가 바뀌면 구분선', () => {
    const day1a = msg({ createdAt: '2026-06-01T01:00:00Z' })
    const day1b = msg({ createdAt: '2026-06-01T10:00:00Z' }) // KST 6/1 19:00
    const day2 = msg({ createdAt: '2026-06-02T03:00:00Z' })
    expect(startsNewDay(day1a, day1b)).toBe(false)
    expect(startsNewDay(day1b, day2)).toBe(true)
  })
  it('UTC 로는 같은 날이어도 KST 자정을 넘으면 새 날', () => {
    // 6/1 14:00Z = KST 6/1 23:00, 6/1 16:00Z = KST 6/2 01:00
    expect(startsNewDay(msg({ createdAt: '2026-06-01T14:00:00Z' }), msg({ createdAt: '2026-06-01T16:00:00Z' }))).toBe(true)
  })
})
