import { describe, expect, it } from 'vitest'

import type { ChannelReadState, MessageResponse } from '../types/messaging'
import { applyReadEvent, readAtLabel, readersByMessage } from './readReceipts'

// DM 읽음 표시(WP-1176) — 얼굴 자리·실시간 반영·읽은 시각 문구.
const ME = 1
const msg = (id: number, authorId: number, deleted = false) =>
  ({ id, authorId, deleted }) as unknown as MessageResponse
const state = (userId: number, lastReadMessageId: number, readAt: string | null = null): ChannelReadState => ({
  userId,
  name: `u${userId}`,
  lastReadMessageId,
  readAt,
})

describe('readersByMessage', () => {
  // 화면 목록은 DESC(최신 먼저)로 온다 — 순서와 관계없이 같은 결과여야 한다.
  const messages = [msg(15, ME), msg(14, 2), msg(13, ME), msg(12, ME, true), msg(11, ME), msg(10, 2)]

  it('각 사람은 읽은 위치 이하의 내 마지막 메시지 한 곳에만 붙는다', () => {
    const map = readersByMessage(messages, [state(2, 15), state(3, 14), state(4, 13)], ME)
    expect(map.get(15)?.map((r) => r.userId)).toEqual([2])
    expect(map.get(13)?.map((r) => r.userId)).toEqual([3, 4])
    expect(map.size).toBe(2)
  })

  it('지운 메시지·보내는 중(음수 id)·남의 메시지는 자리로 쓰지 않는다', () => {
    const map = readersByMessage([msg(-1, ME), ...messages], [state(2, 12), state(3, 10)], ME)
    // 12 는 지운 메시지라 그 앞의 11 에, 10 까지 읽은 사람은 읽은 내 메시지가 없어 붙지 않는다.
    expect(map.get(11)?.map((r) => r.userId)).toEqual([2])
    expect([...map.keys()]).toEqual([11])
  })

  it('목록에 나 자신이 섞여 와도 내 얼굴은 붙이지 않는다', () => {
    expect(readersByMessage(messages, [state(ME, 15)], ME).size).toBe(0)
  })
})

describe('applyReadEvent', () => {
  const states = [state(2, 10, '2026-10-29T03:00:00Z'), state(3, 12)]

  it('위치가 앞으로 가면 그 사람만 위치·시각을 바꾼 새 배열', () => {
    const next = applyReadEvent(states, { userId: 2, lastReadMessageId: 15, readAt: '2026-10-29T03:40:00Z' })
    expect(next).not.toBe(states)
    expect(next?.[0]).toMatchObject({ lastReadMessageId: 15, readAt: '2026-10-29T03:40:00Z' })
    expect(next?.[1]).toBe(states[1])
  })

  it('같은·뒤 위치는 받은 배열 그대로, 시각이 없는 이벤트는 앞선 시각을 새 위치에 붙이지 않는다', () => {
    expect(applyReadEvent(states, { userId: 2, lastReadMessageId: 10, readAt: null })).toBe(states)
    expect(applyReadEvent(states, { userId: 2, lastReadMessageId: 11, readAt: null })?.[0].readAt).toBeNull()
  })

  it('목록에 없는 사람이면 null(호출 측이 다시 받는다)', () => {
    expect(applyReadEvent(states, { userId: 9, lastReadMessageId: 20, readAt: null })).toBeNull()
  })
})

describe('readAtLabel', () => {
  // 2026-10-29 14:00 KST
  const now = new Date('2026-10-29T05:00:00Z')

  it('오늘은 시각, 어제는 「어제」, 올해는 날짜, 시각을 모르면 「읽음」', () => {
    expect(readAtLabel('2026-10-29T03:47:00Z', now)).toBe('오후 12:47에 읽음')
    expect(readAtLabel('2026-10-28T03:47:00Z', now)).toBe('어제 읽음')
    expect(readAtLabel('2026-10-20T03:47:00Z', now)).toBe('10월 20일에 읽음')
    expect(readAtLabel(null, now)).toBe('읽음')
    expect(readAtLabel('nope', now)).toBe('읽음')
  })
})
