import { describe, expect, it } from 'vitest'

import type { EmailMessageSummary } from '@/types/mailMessage'

import { mergeKeptRows } from './mailKeepRows'

const row = (id: number, receivedAt: string, seen = false): EmailMessageSummary => ({
  id, accountId: 1, threadId: `t${id}`, fromAddress: 'a@b', fromName: null, subject: `s${id}`, snippet: null,
  receivedAt, seen, hasAttachment: false, aiCategory: null, aiNeedsReply: null, categoryPending: false,
})

describe('mergeKeptRows', () => {
  it('재조회 결과에 빠진 "연 메일"을 이전 행으로 되살려 수신 시각 순으로 끼운다', () => {
    const prev = [row(3, '2026-10-03T03:00:00Z'), row(2, '2026-10-03T02:00:00Z', true), row(1, '2026-10-03T01:00:00Z')]
    const next = [row(3, '2026-10-03T03:00:00Z'), row(1, '2026-10-03T01:00:00Z')]
    expect(mergeKeptRows(next, prev, new Set([2]))?.map((r) => r.id)).toEqual([3, 2, 1])
  })
  it('유지 대상이 아니면 그대로', () => {
    const prev = [row(2, '2026-10-03T02:00:00Z')]
    const next = [row(1, '2026-10-03T01:00:00Z')]
    expect(mergeKeptRows(next, prev, new Set())?.map((r) => r.id)).toEqual([1])
  })
  it('next 가 undefined(로딩)면 undefined', () => {
    expect(mergeKeptRows(undefined, [], new Set([1]))).toBeUndefined()
  })
  it('이미 있으면 새 데이터를 쓴다(중복 없음)', () => {
    const prev = [row(1, '2026-10-03T01:00:00Z')]
    const next = [row(1, '2026-10-03T01:00:00Z', true)]
    const out = mergeKeptRows(next, prev, new Set([1]))
    expect(out).toHaveLength(1)
    expect(out?.[0].seen).toBe(true)
  })
})
