// WP-1786 보내기 대기열 — useSendMail 성공 뒤 「메일 보냄 · 되돌리기」 토스트(10초), 되돌리기(cancel-send → 쓰기 창 다시 열기),
// 이미 나간 메일(409·404)의 「이미 보냄」, 대기열이 보낸 뒤(20초) 보낸편지함·임시보관함 다시 받기.
// 토스트는 sonner 를 가로채 옵션(동작 라벨·지속 시간)을 본다. API 는 MSW 로 실제 경로를 지난다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'
import type { MailSendRequest } from '@/types/mailMessage'

import { draftDetail } from '../../../e2e/factories/mail.factory'

type ToastOpts = { duration?: number; action?: { label: string; onClick: () => void } }
const success = vi.fn<(msg: string, opts?: ToastOpts) => void>()
const plain = vi.fn<(msg: string, opts?: ToastOpts) => void>()
const error = vi.fn()
vi.mock('sonner', () => ({
  toast: Object.assign((m: string, o?: ToastOpts) => plain(m, o), {
    success: (m: string, o?: ToastOpts) => success(m, o),
    error: (...a: unknown[]) => error(...a),
  }),
}))

const { useSendMail, showSentToast, SEND_UNDO_MS, SENT_REFRESH_MS } = await import('./useMailMessages')
const { mailDraftKeys } = await import('./mailDraftKeys')

const BODY: MailSendRequest = { to: ['a@test.local'], cc: [], bcc: [], subject: '안녕', bodyHtml: '<p>x</p>', bodyText: 'x', inReplyToMessageId: null }

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, wrapper }
}

/** 보내기 응답 — 대기열에 올린 행 id 와 보낼 시각. */
const queued = (draftId: number) => HttpResponse.json({ draftId, sendAt: '2026-11-19T00:00:10Z' })

/** 마지막 「메일 보냄」 토스트의 「되돌리기」를 누른다. */
async function clickUndo() {
  const opts = success.mock.calls.at(-1)?.[1]
  await act(async () => {
    opts?.action?.onClick()
    // cancel-send 응답과 쓰기 창 열기를 기다린다.
    await vi.waitFor(() => expect(cancelCalls.length).toBeGreaterThan(0))
  })
}

let cancelCalls: number[] = []
beforeEach(() => {
  vi.clearAllMocks()
  cancelCalls = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useSendMail — 되돌리기 토스트', () => {
  it('보내기 성공 → 「메일 보냄」 토스트에 「되돌리기」 동작, 10초 동안 보인다', async () => {
    server.use(http.post('/api/v1/mail/accounts/1/send', () => queued(55)))
    const { wrapper } = setup()
    const openDraft = vi.fn()
    const { result } = renderHook(() => useSendMail(openDraft), { wrapper })
    await act(() => result.current.mutateAsync({ accountId: 1, body: BODY }))
    expect(success).toHaveBeenCalledTimes(1)
    const [msg, opts] = success.mock.calls[0]
    expect(msg).toBe('메일 보냄')
    expect(opts?.duration).toBe(10000)
    expect(SEND_UNDO_MS).toBe(10000)
    expect(opts?.action?.label).toBe('되돌리기')
    expect(openDraft).not.toHaveBeenCalled()
  })

  it('「되돌리기」 → cancel-send 를 부르고, 받은 상세로 그 임시보관을 쓰기 창으로 다시 연다', async () => {
    const back = draftDetail({ id: 55, to: ['a@test.local'], subject: '안녕' })
    server.use(
      http.post('/api/v1/mail/accounts/1/send', () => queued(55)),
      http.post('/api/v1/mail/drafts/:id/cancel-send', ({ params }) => {
        cancelCalls.push(Number(params.id))
        return HttpResponse.json(back)
      }),
    )
    const { wrapper } = setup()
    const openDraft = vi.fn()
    const { result } = renderHook(() => useSendMail(openDraft), { wrapper })
    await act(() => result.current.mutateAsync({ accountId: 1, body: BODY }))
    await clickUndo()
    expect(cancelCalls).toEqual([55])
    await vi.waitFor(() => expect(openDraft).toHaveBeenCalledWith(55, back))
    expect(plain).not.toHaveBeenCalledWith('이미 보냄', undefined)
  })

  it.each([
    ['409 ALREADY_SENDING', 409, 'ALREADY_SENDING'],
    ['404 — 이미 보내고 지워짐', 404, 'DRAFT_NOT_FOUND'],
  ])('되돌리기가 늦으면(%s) 「이미 보냄」을 알리고 쓰기 창을 열지 않는다', async (_n, status, code) => {
    server.use(
      http.post('/api/v1/mail/accounts/1/send', () => queued(56)),
      http.post('/api/v1/mail/drafts/:id/cancel-send', ({ params }) => {
        cancelCalls.push(Number(params.id))
        return HttpResponse.json({ status, message: 'x', errors: { code } }, { status })
      }),
    )
    const { wrapper } = setup()
    const openDraft = vi.fn()
    const { result } = renderHook(() => useSendMail(openDraft), { wrapper })
    await act(() => result.current.mutateAsync({ accountId: 1, body: BODY }))
    await clickUndo()
    await vi.waitFor(() => expect(plain).toHaveBeenCalledWith('이미 보냄', undefined))
    expect(openDraft).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('보낸 뒤 20초가 지나면 보낸편지함·임시보관함을 한 번 더 다시 받는다(대기열이 보낸 뒤 반영)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { qc } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    showSentToast(qc, 3, 70, vi.fn())
    const sentKey = { queryKey: ['mail-messages', 3, 'SENT'] }
    const draftsKey = { queryKey: mailDraftKeys.account(3) }
    const before = inval.mock.calls.length
    // 지금은 임시보관함만 — 메일은 아직 대기 중이라 보낸편지함은 다시 받지 않는다.
    expect(inval.mock.calls.map((c) => c[0])).toEqual([draftsKey])
    expect(SENT_REFRESH_MS).toBe(20000)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(inval.mock.calls.length).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(inval.mock.calls.slice(before).map((c) => c[0])).toEqual(expect.arrayContaining([sentKey, draftsKey]))
  })
})
