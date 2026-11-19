// WP-1787 예약 목록·개수 훅 — 가장 이른 예약이 다가왔을 때만 다시 요청한다(코드 리뷰: 예약이 있다고 늘 30초마다 받지 않는다).
// 바로 보내기는 성공하면 그 행을 캐시에서 곧바로 빼고 개수를 줄인다(아직 QUEUED 라 다시 받으면 되살아난다).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'
import type { MailDraftCount, MailScheduledSummary } from '@/types/mailDraft'

import { mailDraftKeys } from './mailDraftKeys'
import { useMailDraftCount, useScheduledMailDrafts, useSendScheduledNow } from './useMailDrafts'

/** 지금부터 ms 뒤에 나가는 예약 행. */
const row = (id: number, ms: number): MailScheduledSummary => ({
  id,
  accountId: 1,
  mode: 'new',
  to: ['a@test.local'],
  subject: 's',
  preview: '',
  attachmentCount: 0,
  updatedAt: '2026-11-19T00:00:00Z',
  sendAt: new Date(Date.now() + ms).toISOString(),
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, wrapper }
}

afterEach(() => vi.useRealTimers())

describe('useScheduledMailDrafts', () => {
  it.each([
    ['가장 이른 예약이 2분 안이면 30초 뒤 다시 요청한다', () => [row(5, 60_000)], 2],
    ['가장 이른 예약이 멀면(하루 뒤) 30초 뒤에는 다시 요청하지 않는다', () => [row(5, 86_400_000)], 1],
    ['0건이면 다시 요청하지 않는다', () => [], 1],
  ])('%s', async (_n, rows, calls) => {
    let count = 0
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const data = rows()
    server.use(http.get('/api/v1/mail/drafts/scheduled', () => { count += 1; return HttpResponse.json(data) }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useScheduledMailDrafts(1), { wrapper })
    await vi.waitFor(() => expect(result.current.data).toEqual(data))
    expect(count).toBe(1)
    await vi.advanceTimersByTimeAsync(31_000)
    await vi.waitFor(() => expect(count).toBe(calls))
  })

  it('가장 이른 예약이 10분 뒤면 그 2분 전(8분 뒤)에 한 번 깨어 다시 요청한다', async () => {
    let count = 0
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const data = [row(5, 10 * 60_000)]
    server.use(http.get('/api/v1/mail/drafts/scheduled', () => { count += 1; return HttpResponse.json(data) }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useScheduledMailDrafts(1), { wrapper })
    await vi.waitFor(() => expect(result.current.data).toEqual(data))
    await vi.advanceTimersByTimeAsync(7 * 60_000)
    expect(count).toBe(1)
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.waitFor(() => expect(count).toBe(2))
  })
})

describe('useMailDraftCount', () => {
  it.each([
    ['nextSendAt 이 2분 안이면 30초 뒤 다시 요청한다', 60_000, 2],
    ['nextSendAt 이 멀면 30초 뒤에는 다시 요청하지 않는다', 86_400_000, 1],
    ['예약이 없으면(null) 다시 요청하지 않는다', null, 1],
  ])('%s', async (_n, ms, calls) => {
    let count = 0
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const body: MailDraftCount = {
      count: 0,
      queued: ms == null ? 0 : 1,
      scheduled: ms == null ? 0 : 1,
      nextSendAt: ms == null ? null : new Date(Date.now() + ms).toISOString(),
    }
    server.use(http.get('/api/v1/mail/drafts/count', () => { count += 1; return HttpResponse.json(body) }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useMailDraftCount(1), { wrapper })
    await vi.waitFor(() => expect(result.current.data).toEqual(body))
    await vi.advanceTimersByTimeAsync(31_000)
    await vi.waitFor(() => expect(count).toBe(calls))
  })
})

describe('useSendScheduledNow', () => {
  it('성공하면 그 행을 예약 목록에서 곧바로 빼고 개수를 줄이며, 지금 다시 받지 않고 나중에 보낸편지함까지 다시 받는다', async () => {
    server.use(http.post('/api/v1/mail/drafts/5/send-now', () => HttpResponse.json({ draftId: 5, sendAt: '2026-11-19T00:00:00Z' })))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const { wrapper, qc } = setup()
    const sent = row(5, 3_600_000)
    const later = row(6, 7_200_000)
    qc.setQueryData(mailDraftKeys.scheduled(1), [sent, later])
    qc.setQueryData<MailDraftCount>(mailDraftKeys.count(1), { count: 0, queued: 2, scheduled: 2, nextSendAt: sent.sendAt })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useSendScheduledNow(1), { wrapper })
    result.current.mutate(5)
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(qc.getQueryData(mailDraftKeys.scheduled(1))).toEqual([later])
    expect(qc.getQueryData(mailDraftKeys.count(1))).toEqual({ count: 0, queued: 2, scheduled: 1, nextSendAt: later.sendAt })
    // 지금 다시 받으면 아직 QUEUED 인 행이 되살아난다 — 무효화하지 않는다.
    expect(spy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(21_000)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['mail-messages', 1, 'SENT'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: mailDraftKeys.account(1) })
  })
})
