// @vitest-environment jsdom
// WP-962 옮기기 대기열 — 토스트가 닫힐 때만 보내고, 실행 취소면 보내지 않고, 페이지를 떠나면 keepalive 로 보내는지.
import { QueryClient } from '@tanstack/react-query'
import type { ExternalToast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const success = vi.fn<(message: string, data?: ExternalToast) => number>(() => 7)
const error = vi.fn()
const dismiss = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...a: [string, ExternalToast?]) => success(...a),
    error: (...a: unknown[]) => error(...a),
    dismiss: (...a: unknown[]) => dismiss(...a),
  },
}))
const moveMessages = vi.fn()
const moveMessagesOnUnload = vi.fn()
vi.mock('@/api/mailMessages', () => ({
  moveMessages: (...a: unknown[]) => moveMessages(...a),
  moveMessagesOnUnload: (...a: unknown[]) => moveMessagesOnUnload(...a),
}))

const { scheduleMailMove, mailMoveHiddenSnapshot, resetMailMoveQueueForTest } = await import('./mailMoveQueue')

const fakeToast = { id: 7 } as Parameters<NonNullable<ExternalToast['onDismiss']>>[0]
const lastToast = () => success.mock.calls.at(-1)![1]!

function schedule(qc = new QueryClient(), onUndo?: () => void) {
  scheduleMailMove({ qc, accountId: 3, messageIds: [11, 12], target: { kind: 'ARCHIVE' }, message: '2통을 보관했습니다', onUndo })
  return qc
}

describe('scheduleMailMove', () => {
  beforeEach(() => {
    resetMailMoveQueueForTest()
    vi.clearAllMocks()
  })

  it('바로 숨기고, 토스트가 닫히기 전에는 보내지 않는다', () => {
    schedule()
    expect([...mailMoveHiddenSnapshot()]).toEqual([11, 12])
    expect(success).toHaveBeenCalledWith('2통을 보관했습니다', expect.anything())
    expect(moveMessages).not.toHaveBeenCalled()
  })

  it('토스트가 닫히면 보내고, 목록을 다시 받은 뒤 숨김을 푼다', async () => {
    moveMessages.mockResolvedValue({ results: [{ messageId: 11, ok: true, error: null }, { messageId: 12, ok: true, error: null }] })
    const qc = schedule()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    lastToast().onAutoClose!(fakeToast)
    expect(moveMessages).toHaveBeenCalledWith(3, { messageIds: [11, 12], target: { kind: 'ARCHIVE' } })
    await vi.waitFor(() => expect(mailMoveHiddenSnapshot().size).toBe(0))
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-messages', 3] })
    expect(error).not.toHaveBeenCalled()
  })

  it('실행 취소면 보내지 않고 다시 보인다', () => {
    const onUndo = vi.fn()
    schedule(new QueryClient(), onUndo)
    const t = lastToast()
    ;(t.action as { onClick: (e: unknown) => void }).onClick({})
    t.onDismiss!(fakeToast)
    expect(moveMessages).not.toHaveBeenCalled()
    expect(mailMoveHiddenSnapshot().size).toBe(0)
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('일부 실패 — 실패한 메일만 되돌리고 알린다', async () => {
    moveMessages.mockResolvedValue({
      results: [{ messageId: 11, ok: true, error: null }, { messageId: 12, ok: false, error: '메일 서버에서 메일을 찾을 수 없습니다' }],
    })
    schedule()
    lastToast().onDismiss!(fakeToast)
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('메일을 옮기지 못했어요 — 메일 서버에서 메일을 찾을 수 없습니다'))
    await vi.waitFor(() => expect(mailMoveHiddenSnapshot().size).toBe(0))
  })

  it('요청 실패 — 모두 되돌리고 오류 토스트', async () => {
    moveMessages.mockRejectedValue(new Error('boom'))
    schedule()
    lastToast().onAutoClose!(fakeToast)
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    expect(mailMoveHiddenSnapshot().size).toBe(0)
  })

  it('화면이 숨으면 keepalive 로 보내고, 다시 보이면 목록을 다시 받은 뒤 숨김을 푼다', async () => {
    const qc = schedule()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const setVisibility = (v: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    setVisibility('hidden')
    expect(moveMessagesOnUnload).toHaveBeenCalledWith(3, { messageIds: [11, 12], target: { kind: 'ARCHIVE' } })
    expect(mailMoveHiddenSnapshot().size).toBe(2) // 결과를 모르니 아직 숨긴 채
    lastToast().onAutoClose!(fakeToast)
    expect(moveMessages).not.toHaveBeenCalled() // 두 번 보내지 않는다
    setVisibility('visible')
    await vi.waitFor(() => expect(mailMoveHiddenSnapshot().size).toBe(0))
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-messages', 3] })
  })

  it('페이지를 떠나면 대기 중인 옮기기를 keepalive 로 보내고 토스트 결론은 다시 보내지 않는다', () => {
    schedule()
    window.dispatchEvent(new Event('pagehide'))
    expect(moveMessagesOnUnload).toHaveBeenCalledWith(3, { messageIds: [11, 12], target: { kind: 'ARCHIVE' } })
    expect(dismiss).toHaveBeenCalledWith(7)
    lastToast().onAutoClose!(fakeToast)
    expect(moveMessages).not.toHaveBeenCalled()
  })
})
