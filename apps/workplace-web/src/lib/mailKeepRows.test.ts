import { describe, expect, it } from 'vitest'

import type { EmailMessageSummary } from '@/types/mailMessage'

import { markSeenInKept, mergeKeptRows } from './mailKeepRows'

const row = (id: number, receivedAt: string, seen = false): EmailMessageSummary => ({
  id, accountId: 1, threadId: `t${id}`, fromAddress: 'a@b', fromName: null, subject: `s${id}`, snippet: null,
  receivedAt, seen, hasAttachment: false, aiCategory: null, aiNeedsReply: null, categoryPending: false,
})

describe('mergeKeptRows', () => {
  it('재조회 결과에 빠진 "연 메일"을 이전 행으로 되살려 수신 시각 순으로 끼운다', () => {
    const kept = new Map([[2, row(2, '2026-10-03T02:00:00Z', true)]])
    const next = [row(3, '2026-10-03T03:00:00Z'), row(1, '2026-10-03T01:00:00Z')]
    expect(mergeKeptRows(next, kept)?.map((r) => r.id)).toEqual([3, 2, 1])
  })
  it('유지 대상이 아니면 그대로', () => {
    const next = [row(1, '2026-10-03T01:00:00Z')]
    expect(mergeKeptRows(next, new Map())?.map((r) => r.id)).toEqual([1])
  })
  it('next 가 undefined(로딩)면 undefined', () => {
    expect(mergeKeptRows(undefined, new Map([[1, row(1, '2026-10-03T01:00:00Z')]]))).toBeUndefined()
  })
  it('이미 있으면 새 데이터를 쓴다(중복 없음)', () => {
    const kept = new Map([[1, row(1, '2026-10-03T01:00:00Z')]])
    const next = [row(1, '2026-10-03T01:00:00Z', true)]
    const out = mergeKeptRows(next, kept)
    expect(out).toHaveLength(1)
    expect(out?.[0].seen).toBe(true)
  })
})

describe('markSeenInKept', () => {
  const kept = new Map([
    [1, row(1, '2026-10-03T01:00:00Z')],
    [2, row(2, '2026-10-03T02:00:00Z')],
  ])
  it("'all' 이면 모든 유지 행의 seen 을 바꾸고 원본은 건드리지 않는다", () => {
    const out = markSeenInKept(kept, 'all', true)
    expect([...out.values()].map((r) => r.seen)).toEqual([true, true])
    expect(out).not.toBe(kept)
    expect(kept.get(1)?.seen).toBe(false)
  })
  it('ids 에 있는 행만 바꾸고 없는 id 는 새로 넣지 않는다', () => {
    const out = markSeenInKept(kept, [2, 9], true)
    expect(out.get(1)?.seen).toBe(false)
    expect(out.get(2)?.seen).toBe(true)
    expect(out.has(9)).toBe(false)
  })
})
