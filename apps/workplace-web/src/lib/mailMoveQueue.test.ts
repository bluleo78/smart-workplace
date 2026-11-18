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

const { scheduleMailMove, flushMailMoves, mailMoveHiddenSnapshot, mailMovePatchSnapshot, resetMailMoveQueueForTest } = await import('./mailMoveQueue')

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

  it('WP-1708 옮기기가 끝나면 실시간 휴지통 수(trashCount)도 다시 받는다 — 휴지통으로 옮긴 직후 줄이 낡은 수를 보이지 않게', async () => {
    moveMessages.mockResolvedValue({ results: [{ messageId: 11, ok: true, error: null }, { messageId: 12, ok: true, error: null }] })
    const qc = schedule()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    lastToast().onAutoClose!(fakeToast)
    await vi.waitFor(() => expect(mailMoveHiddenSnapshot().size).toBe(0))
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-trash-count', 3] })
  })

  it('WP-1742 hideRows:false — 숨기지 않지만 토스트가 닫히면 보내고 목록을 다시 받는다(별표 보기의 보관·옮기기)', async () => {
    moveMessages.mockResolvedValue({ results: [{ messageId: 11, ok: true, error: null }] })
    const qc = new QueryClient()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    scheduleMailMove({ qc, accountId: 3, messageIds: [11], target: { kind: 'ARCHIVE' }, message: '보관했습니다', hideRows: false })
    expect(mailMoveHiddenSnapshot().size).toBe(0)
    expect(success).toHaveBeenCalledWith('보관했습니다', expect.anything())
    lastToast().onAutoClose!(fakeToast)
    expect(moveMessages).toHaveBeenCalledWith(3, { messageIds: [11], target: { kind: 'ARCHIVE' } })
    await vi.waitFor(() => expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-messages', 3] }))
    expect(mailMoveHiddenSnapshot().size).toBe(0)
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

  // WP-1682 휴지통 비우기를 시작하기 전에 그 계정의 대기 중 옮기기(예: 방금 되살린 메일)를 먼저 보낸다.
  it('flushMailMoves — 그 계정의 대기 옮기기만 바로 보내고 끝까지 기다린다, 다른 계정 대기는 남는다', async () => {
    moveMessages.mockResolvedValue({ results: [{ messageId: 11, ok: true, error: null }, { messageId: 12, ok: true, error: null }] })
    const qc = new QueryClient()
    scheduleMailMove({ qc, accountId: 3, messageIds: [11, 12], target: { kind: 'RESTORE' }, message: '2통을 되살렸습니다' })
    scheduleMailMove({ qc, accountId: 4, messageIds: [21], target: { kind: 'ARCHIVE' }, message: '1통을 보관했습니다' })
    expect(moveMessages).not.toHaveBeenCalled()

    await flushMailMoves(3)

    // 보냈고(끝까지 기다렸으므로 숨김도 이미 풀렸다), 토스트는 닫혔고, 다른 계정 것은 그대로 숨은 채 대기한다.
    expect(moveMessages).toHaveBeenCalledTimes(1)
    expect(moveMessages).toHaveBeenCalledWith(3, { messageIds: [11, 12], target: { kind: 'RESTORE' } })
    expect(dismiss).toHaveBeenCalledWith(7)
    expect([...mailMoveHiddenSnapshot()]).toEqual([21])
    // 이미 결론이 난 토스트가 나중에 닫혀도 두 번 보내지 않는다.
    success.mock.calls[0][1]!.onAutoClose!(fakeToast)
    expect(moveMessages).toHaveBeenCalledTimes(1)
    // 그 계정에 대기가 없으면 아무 일도 없다.
    await flushMailMoves(3)
    expect(moveMessages).toHaveBeenCalledTimes(1)
  })

  // WP-1682 토스트가 이미 닫혀 응답을 기다리는 되살리기도 기다린다 — 비우기가 서버 휴지통을 스냅샷하는 사이 되살릴 메일이 지워지지 않게.
  it('flushMailMoves — 부르기 전에 시작돼 응답을 기다리는 옮기기가 끝날 때까지 기다린다', async () => {
    let release: (v: unknown) => void = () => {}
    moveMessages.mockReturnValue(new Promise((r) => (release = r)))
    const qc = new QueryClient()
    scheduleMailMove({ qc, accountId: 3, messageIds: [11], target: { kind: 'RESTORE' }, message: '1통을 되살렸습니다' })
    lastToast().onAutoClose!(fakeToast) // 토스트가 닫혀 요청이 나갔다(대기열에는 없다)
    expect(moveMessages).toHaveBeenCalledTimes(1)

    let done = false
    const flushing = flushMailMoves(3).then(() => {
      done = true
    })
    // 다른 계정의 기다림은 곧바로 끝난다.
    await flushMailMoves(4)
    await new Promise((r) => setTimeout(r, 0))
    expect(done).toBe(false)

    release({ results: [{ messageId: 11, ok: true, error: null }] })
    await flushing
    expect(done).toBe(true)
    expect(moveMessages).toHaveBeenCalledTimes(1) // 다시 보내지 않는다
    expect(mailMoveHiddenSnapshot().size).toBe(0) // 목록 갱신·숨김 해제까지 끝났다
  })

  // 되살리기가 실패해도 비우기를 막지 않는다 — 오류 토스트가 떴고 메일은 휴지통에 다시 보인다.
  it('flushMailMoves — 응답을 기다리던 옮기기가 실패해도 기다림은 끝난다', async () => {
    let fail: (e: unknown) => void = () => {}
    moveMessages.mockReturnValue(new Promise((_, rej) => (fail = rej)))
    scheduleMailMove({ qc: new QueryClient(), accountId: 3, messageIds: [11], target: { kind: 'RESTORE' }, message: '1통을 되살렸습니다' })
    lastToast().onAutoClose!(fakeToast)

    const flushing = flushMailMoves(3)
    fail(new Error('network'))
    await flushing
    expect(error).toHaveBeenCalled()
    expect(mailMoveHiddenSnapshot().size).toBe(0)
  })

  // WP-1742 별표 보기의 보관·옮기기 — 대기 중에는 목적지 메일함 값(rowPatch)을 얹어 같은 행에 「보관」이 다시 보이지 않게 한다.
  describe('rowPatch(대기 중 목적지 메일함)', () => {
    const ARCH = { folderId: 1, folderRole: 'ARCHIVE', folderName: '보관' }
    const PROJ = { folderId: 5, folderRole: 'USER', folderName: '프로젝트' }
    const move = (patch: typeof ARCH, qc = new QueryClient()) =>
      scheduleMailMove({ qc, accountId: 3, messageIds: [11], target: { kind: 'ARCHIVE' }, message: '보관했습니다', hideRows: false, rowPatch: patch })

    it('예약하면 얹고, 실행 취소하면 뗀다', () => {
      move(ARCH)
      expect(mailMovePatchSnapshot().get(11)).toEqual(ARCH)
      ;(lastToast().action as { onClick: (e: unknown) => void }).onClick({})
      expect(mailMovePatchSnapshot().has(11)).toBe(false)
    })

    it('옮긴 뒤 목록을 다시 받은 다음에 뗀다(그 사이 옛 메일함으로 깜빡이지 않게)', async () => {
      let release: () => void = () => {}
      const qc = new QueryClient()
      vi.spyOn(qc, 'invalidateQueries').mockReturnValue(new Promise<void>((r) => (release = r)))
      moveMessages.mockResolvedValue({ results: [{ messageId: 11, ok: true, error: null }] })
      move(ARCH, qc)
      lastToast().onAutoClose!(fakeToast)
      await new Promise((r) => setTimeout(r, 0))
      expect(mailMovePatchSnapshot().get(11)).toEqual(ARCH)
      release()
      await vi.waitFor(() => expect(mailMovePatchSnapshot().has(11)).toBe(false))
    })

    it('옮긴 뒤 onMoved 를 성공한 id 로, 목적지 값을 떼기 전에 부른다(스냅샷에 옮겨 적을 수 있게)', async () => {
      moveMessages.mockResolvedValue({ results: [{ messageId: 11, ok: true, error: null }, { messageId: 12, ok: false, error: 'x' }] })
      const seen: unknown[] = []
      scheduleMailMove({
        qc: new QueryClient(), accountId: 3, messageIds: [11, 12], target: { kind: 'ARCHIVE' }, message: '보관했습니다', hideRows: false, rowPatch: ARCH,
        onMoved: (ids) => seen.push([ids, mailMovePatchSnapshot().get(11)]),
      })
      lastToast().onAutoClose!(fakeToast)
      await vi.waitFor(() => expect(seen).toEqual([[[11], ARCH]]))
      expect(mailMovePatchSnapshot().size).toBe(0)
    })

    it('옮기기에 실패하면 바로 뗀다(원래 메일함으로 돌아온다)', async () => {
      moveMessages.mockResolvedValue({ results: [{ messageId: 11, ok: false, error: 'x' }] })
      move(ARCH)
      lastToast().onAutoClose!(fakeToast)
      await vi.waitFor(() => expect(mailMovePatchSnapshot().has(11)).toBe(false))
      expect(error).toHaveBeenCalled()
    })

    it('대기 중에 또 옮기면 나중 것이 보이고, 나중 것을 취소하면 앞의 목적지로 돌아간다', () => {
      move(ARCH)
      const first = lastToast()
      move(PROJ)
      expect(mailMovePatchSnapshot().get(11)).toEqual(PROJ)
      ;(lastToast().action as { onClick: (e: unknown) => void }).onClick({})
      expect(mailMovePatchSnapshot().get(11)).toEqual(ARCH)
      ;(first.action as { onClick: (e: unknown) => void }).onClick({})
      expect(mailMovePatchSnapshot().has(11)).toBe(false)
    })
  })
})
