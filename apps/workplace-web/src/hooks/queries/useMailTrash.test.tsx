// @vitest-environment jsdom
// WP-1682 휴지통 훅 — 완전 삭제 결과별 토스트·무효화, 비우기 시작(대기 옮기기 먼저·이미 끝난 응답), 상태 전이 토스트.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AxiosError, type AxiosResponse } from 'axios'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MailTrashEmptyStatus } from '@/types/mailFolder'

const success = vi.fn()
const warning = vi.fn()
const error = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => success(...a), warning: (...a: unknown[]) => warning(...a), error: (...a: unknown[]) => error(...a) },
}))
const permanentDeleteMessages = vi.fn()
const startTrashEmpty = vi.fn()
const getTrashEmptyStatus = vi.fn()
const syncMailbox = vi.fn()
const syncMailFolder = vi.fn()
vi.mock('@/api/mailMessages', () => ({
  syncMailbox: (...a: unknown[]) => syncMailbox(...a),
  syncMailFolder: (...a: unknown[]) => syncMailFolder(...a),
  permanentDeleteMessages: (...a: unknown[]) => permanentDeleteMessages(...a),
  startTrashEmpty: (...a: unknown[]) => startTrashEmpty(...a),
  getTrashEmptyStatus: (...a: unknown[]) => getTrashEmptyStatus(...a),
}))
const flushMailMoves = vi.fn()
vi.mock('@/lib/mailMoveQueue', () => ({ flushMailMoves: (...a: unknown[]) => flushMailMoves(...a) }))

const { useSyncMailbox, useSyncMailFolder } = await import('./useMailMessages')
const { usePermanentDeleteMail, useStartTrashEmpty, useTrashEmptyStatus } = await import('./useMailTrash')

const st = (over: Partial<MailTrashEmptyStatus> = {}): MailTrashEmptyStatus => ({
  state: 'IDLE', total: null, deleted: 0, failed: 0, startedAt: null, finishedAt: null, errorCode: null, error: null, ...over,
})

/** 서버 오류 응답을 가진 AxiosError — message·errors.code 는 ErrorResponse 모양. */
function apiError(message: string | undefined, code?: string) {
  const data = { message, errors: code ? { code } : undefined }
  return new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, undefined, { status: 400, data } as AxiosResponse)
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
  flushMailMoves.mockResolvedValue(undefined)
})

describe('usePermanentDeleteMail', () => {
  it('ok — 성공 토스트·onDeleted·목록/안 읽은 수 무효화·상세는 다시 받지 않고 낡음 표시, true', async () => {
    permanentDeleteMessages.mockResolvedValue({ results: [{ messageId: 7, ok: true, error: null }] })
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const onDeleted = vi.fn()
    const { result } = renderHook(() => usePermanentDeleteMail(3, { onDeleted }), { wrapper })
    let ok: boolean | undefined
    await act(async () => { ok = await result.current.mutateAsync(7) })
    expect(ok).toBe(true)
    expect(permanentDeleteMessages).toHaveBeenCalledWith(3, [7])
    expect(success).toHaveBeenCalledWith('완전히 삭제했습니다')
    expect(onDeleted).toHaveBeenCalledWith(7)
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-messages', 3] })
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-unread-counts'] })
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-message', 7], refetchType: 'none' })
  })

  it('ok=false — 메일별 오류 토스트, false, onDeleted 없음', async () => {
    permanentDeleteMessages.mockResolvedValue({ results: [{ messageId: 7, ok: false, error: '메일함이 바뀌었습니다' }] })
    const { wrapper } = setup()
    const onDeleted = vi.fn()
    const { result } = renderHook(() => usePermanentDeleteMail(3, { onDeleted }), { wrapper })
    let ok: boolean | undefined
    await act(async () => { ok = await result.current.mutateAsync(7) })
    expect(ok).toBe(false)
    expect(error).toHaveBeenCalledWith('완전히 삭제하지 못했습니다 — 메일함이 바뀌었습니다')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })

  it('요청 오류 — 서버 message 를 덧붙이고, 없으면 문구만', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => usePermanentDeleteMail(3, { onDeleted: vi.fn() }), { wrapper })
    permanentDeleteMessages.mockRejectedValueOnce(apiError('메일 서버에 연결하지 못했습니다'))
    await act(async () => { await result.current.mutateAsync(7).catch(() => undefined) })
    expect(error).toHaveBeenLastCalledWith('완전히 삭제하지 못했습니다 — 메일 서버에 연결하지 못했습니다')
    permanentDeleteMessages.mockRejectedValueOnce(apiError(undefined))
    await act(async () => { await result.current.mutateAsync(7).catch(() => undefined) })
    expect(error).toHaveBeenLastCalledWith('완전히 삭제하지 못했습니다')
    permanentDeleteMessages.mockRejectedValueOnce(new Error('boom'))
    await act(async () => { await result.current.mutateAsync(7).catch(() => undefined) })
    expect(error).toHaveBeenLastCalledWith('완전히 삭제하지 못했습니다')
  })

  it('PERMANENT_DELETE_UNSUPPORTED — 메일함 목록 무효화', async () => {
    permanentDeleteMessages.mockRejectedValue(apiError('이 메일 서버는 완전히 삭제를 지원하지 않습니다', 'PERMANENT_DELETE_UNSUPPORTED'))
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => usePermanentDeleteMail(3, { onDeleted: vi.fn() }), { wrapper })
    await act(async () => { await result.current.mutateAsync(7).catch(() => undefined) })
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-unread-counts', 3, 'folders'] })
    expect(error).toHaveBeenCalledWith('완전히 삭제하지 못했습니다 — 이 메일 서버는 완전히 삭제를 지원하지 않습니다')
  })
})

describe('useStartTrashEmpty', () => {
  it('대기 옮기기를 먼저 보낸 뒤 시작하고, 응답 RUNNING 을 상태 query 에 넣는다(토스트 없음)', async () => {
    const order: string[] = []
    flushMailMoves.mockImplementation(async () => { order.push('flush') })
    startTrashEmpty.mockImplementation(async () => { order.push('start'); return st({ state: 'RUNNING', total: null }) })
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useStartTrashEmpty(3), { wrapper })
    await act(async () => { await result.current.mutateAsync() })
    expect(flushMailMoves).toHaveBeenCalledWith(3)
    expect(order).toEqual(['flush', 'start'])
    expect(qc.getQueryData(['mail-trash-empty', 3])).toMatchObject({ state: 'RUNNING' })
    expect(success).not.toHaveBeenCalled()
    expect(warning).not.toHaveBeenCalled()
  })

  it('응답이 이미 DONE — 끝 토스트와 같은 무효화', async () => {
    startTrashEmpty.mockResolvedValue(st({ state: 'DONE', total: 4, deleted: 4 }))
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useStartTrashEmpty(3), { wrapper })
    await act(async () => { await result.current.mutateAsync() })
    expect(success).toHaveBeenCalledWith('휴지통을 비웠습니다 (4통)')
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-messages', 3] })
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-unread-counts'] })
  })

  it('응답이 이미 FAILED·실패 있는 DONE — 오류·경고 토스트', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useStartTrashEmpty(3), { wrapper })
    startTrashEmpty.mockResolvedValueOnce(st({ state: 'FAILED', error: '메일 서버에 연결하지 못했습니다' }))
    await act(async () => { await result.current.mutateAsync() })
    expect(error).toHaveBeenLastCalledWith('휴지통을 비우지 못했습니다 — 메일 서버에 연결하지 못했습니다')
    startTrashEmpty.mockResolvedValueOnce(st({ state: 'DONE', total: 5, deleted: 3, failed: 2 }))
    await act(async () => { await result.current.mutateAsync() })
    expect(warning).toHaveBeenLastCalledWith('3통을 지우고 2통은 지우지 못했습니다. 다시 비워 주세요.')
  })

  it('요청 오류 — 서버 message, UIDPLUS 코드면 메일함 목록 무효화', async () => {
    startTrashEmpty.mockRejectedValue(apiError('이 메일 서버는 완전히 삭제를 지원하지 않습니다', 'PERMANENT_DELETE_UNSUPPORTED'))
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useStartTrashEmpty(3), { wrapper })
    await act(async () => { await result.current.mutateAsync().catch(() => undefined) })
    expect(error).toHaveBeenCalledWith('이 메일 서버는 완전히 삭제를 지원하지 않습니다')
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-unread-counts', 3, 'folders'] })
  })
})

describe('useTrashEmptyStatus', () => {
  it('이미 끝난 상태로 열면 알리지 않는다(토스트·무효화 없음)', async () => {
    getTrashEmptyStatus.mockResolvedValue(st({ state: 'DONE', total: 3, deleted: 3 }))
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useTrashEmptyStatus(3, true), { wrapper })
    await waitFor(() => expect(result.current.data?.state).toBe('DONE'))
    expect(success).not.toHaveBeenCalled()
    expect(warning).not.toHaveBeenCalled()
    expect(inval).not.toHaveBeenCalled()
  })

  it('RUNNING → DONE 전이 — 토스트 한 번과 목록·메일함 목록 무효화', async () => {
    getTrashEmptyStatus.mockResolvedValue(st({ state: 'RUNNING', total: 5, deleted: 2 }))
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useTrashEmptyStatus(3, true), { wrapper })
    await waitFor(() => expect(result.current.data?.state).toBe('RUNNING'))
    expect(success).not.toHaveBeenCalled()
    getTrashEmptyStatus.mockResolvedValue(st({ state: 'DONE', total: 5, deleted: 5 }))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(success).toHaveBeenCalledWith('휴지통을 비웠습니다 (5통)'))
    expect(success).toHaveBeenCalledTimes(1)
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-messages', 3] })
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-unread-counts'] })
  })

  it('RUNNING → IDLE — 중단 경고', async () => {
    getTrashEmptyStatus.mockResolvedValue(st({ state: 'RUNNING', total: 5 }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useTrashEmptyStatus(3, true), { wrapper })
    await waitFor(() => expect(result.current.data?.state).toBe('RUNNING'))
    getTrashEmptyStatus.mockResolvedValue(st({ state: 'IDLE' }))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(warning).toHaveBeenCalledWith('휴지통 비우기가 중단됐습니다. 남은 메일이 있으면 다시 비워 주세요.'))
  })

  it('enabled=false 면 묻지 않는다', () => {
    const { wrapper } = setup()
    renderHook(() => useTrashEmptyStatus(3, false), { wrapper })
    expect(getTrashEmptyStatus).not.toHaveBeenCalled()
  })
})

// WP-1708 실시간 휴지통 수 — 메일이 휴지통으로 오는 경로(동기화)에서도 낡지 않게 무효화한다.
describe('동기화 뒤 실시간 휴지통 수 무효화', () => {
  it('계정 동기화(useSyncMailbox) 성공 — trashCount 무효화', async () => {
    syncMailbox.mockResolvedValue({ saved: 0 })
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useSyncMailbox(3), { wrapper })
    await act(async () => { await result.current.mutateAsync() })
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-trash-count', 3] })
  })

  it('메일함 동기화(useSyncMailFolder) 성공 — trashCount 무효화', async () => {
    syncMailFolder.mockResolvedValue({ running: false })
    const { qc, wrapper } = setup()
    const inval = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useSyncMailFolder(3), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        folderId: 9,
        older: false,
        mailListQueryKey: ['mail-messages', 3, 'INBOX', '', false, '', false, 9, false],
      })
    })
    expect(inval).toHaveBeenCalledWith({ queryKey: ['mail-trash-count', 3], exact: true })
  })
})

describe('메일함 동기화 캐시 갱신 범위', () => {
  it('현재 화면 밖의 같은 계정 메일 목록도 무효화해 다시 받는다', async () => {
    syncMailFolder.mockResolvedValue({ running: false })
    const { wrapper } = setup()
    const currentKey = ['mail-messages', 3, 'ARCHIVE', '', false, '', false, 9, false] as const
    const siblingKey = ['mail-messages', 3, 'INBOX', '', false, '', false, null, false] as const
    let currentCalls = 0
    let siblingCalls = 0
    let releaseSibling!: () => void
    const siblingRefresh = new Promise<void>((resolve) => { releaseSibling = resolve })
    const { result } = renderHook(() => {
      useQuery({
        queryKey: currentKey,
        queryFn: async () => {
          currentCalls += 1
          return []
        },
        staleTime: Infinity,
      })
      useQuery({
        queryKey: siblingKey,
        queryFn: async () => {
          siblingCalls += 1
          if (siblingCalls > 1) await siblingRefresh
          return []
        },
        staleTime: Infinity,
      })
      return useSyncMailFolder(3)
    }, { wrapper })
    try {
      await waitFor(() => expect(siblingCalls).toBe(1))
      let operation!: ReturnType<typeof result.current.mutateAsync>
      act(() => {
        operation = result.current.mutateAsync({
          folderId: 9,
          older: false,
          mailListQueryKey: currentKey,
        })
      })
      await act(async () => { await operation })
      expect(currentCalls).toBe(2)
      expect(siblingCalls).toBe(2)
      // mutateAsync 가 끝나도 훅 재렌더는 notifyManager 타이머로 미뤄져 부하 때 act 뒤로 밀리므로 상태 전이를 기다린다 (WP-2005)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    } finally {
      releaseSibling()
    }
  })

  it('휴지통 폴더는 휴지통 수 재조회가 끝날 때까지 동기화 중으로 둔다', async () => {
    syncMailFolder.mockResolvedValue({ running: false })
    const { qc, wrapper } = setup()
    const trashCountKey = ['mail-trash-count', 3]
    let releaseTrashCount!: () => void
    const trashCountRefresh = new Promise<void>((resolve) => { releaseTrashCount = resolve })
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) =>
      JSON.stringify(filters?.queryKey) === JSON.stringify(trashCountKey) ? trashCountRefresh : Promise.resolve(),
    )
    const { result } = renderHook(() => useSyncMailFolder(3), { wrapper })
    let done = false
    let operation!: Promise<void>
    act(() => {
      operation = result.current.mutateAsync({
        folderId: 20,
        older: false,
        waitForTrashCount: true,
        mailListQueryKey: ['mail-messages', 3, 'INBOX', '', false, '', false, 20, false],
      }).then(() => { done = true })
    })
    try {
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: trashCountKey, exact: true }))
      await act(async () => { await Promise.resolve() })
      expect(done).toBe(false)
      await act(async () => {
        releaseTrashCount()
        await operation
      })
      expect(done).toBe(true)
    } finally {
      releaseTrashCount()
    }
  })
})

describe('useSyncMailFolder 완료 시점', () => {
  const currentListKey = ['mail-messages', 3, 'INBOX', '', false, '', false, 9, false] as const
  const relatedListsKey = ['mail-messages', 3] as const
  const foldersKey = ['mail-unread-counts', 3, 'folders'] as const
  const trashCountKey = ['mail-trash-count', 3] as const

  it.each([false, true])('running=%s — 현재 메일 목록과 폴더만 기다리고 나머지 목록은 기다리지 않는다', async (running) => {
    vi.useFakeTimers()
    try {
      syncMailFolder.mockResolvedValue({ running })
      const { qc, wrapper } = setup()
      const finishRefreshes = new Map<string, Array<() => void>>()
      const inval = vi.spyOn(qc, 'invalidateQueries').mockImplementation(
        (filters) => new Promise<void>((resolve) => {
          const key = JSON.stringify(filters?.queryKey)
          finishRefreshes.set(key, [...(finishRefreshes.get(key) ?? []), resolve])
        }),
      )
      const { result } = renderHook(() => useSyncMailFolder(3), { wrapper })
      const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
      const finishRefreshesFor = (keys: readonly (readonly unknown[])[]) => act(async () => {
        for (const key of keys) {
          const keyText = JSON.stringify(key)
          const pending = finishRefreshes.get(keyText) ?? []
          expect(pending.length).toBeGreaterThan(0)
          pending.shift()?.()
          finishRefreshes.set(keyText, pending)
        }
        await vi.advanceTimersByTimeAsync(1)
      })
      const releaseBackgroundRefreshes = () => {
        for (const key of [relatedListsKey, trashCountKey]) {
          const pending = finishRefreshes.get(JSON.stringify(key)) ?? []
          pending.splice(0).forEach((finish) => finish())
        }
      }

      act(() => { result.current.mutate({ folderId: 9, older: false, mailListQueryKey: currentListKey }) })
      await advance(1)
      expect(inval).toHaveBeenCalledTimes(4)
      expect(inval).toHaveBeenCalledWith(expect.objectContaining({
        queryKey: relatedListsKey,
        predicate: expect.any(Function),
      }))
      expect(inval).toHaveBeenCalledWith({ queryKey: currentListKey, exact: true })
      expect(inval).toHaveBeenCalledWith({ queryKey: foldersKey, exact: true })
      expect(inval).toHaveBeenCalledWith({ queryKey: trashCountKey, exact: true })
      expect(result.current.isPending).toBe(true)

      await finishRefreshesFor([currentListKey, foldersKey])
      if (running) {
        // 재조회 이후 3초 대기는 목록·폴더 재조회 뒤에 시작한다.
        expect(result.current.isPending).toBe(true)
        await advance(2_998)
        expect(inval).toHaveBeenCalledTimes(4)
        expect(result.current.isPending).toBe(true)
        await advance(1)
        expect(inval).toHaveBeenCalledTimes(8)
        expect(result.current.isPending).toBe(true)
        await finishRefreshesFor([currentListKey, foldersKey])
      } else {
        expect(result.current.isSuccess).toBe(true)
      }

      expect(result.current.isSuccess).toBe(true)
      // 다른 보기와 휴지통 수는 최신화하되, 일반 폴더의 완료를 막지 않는다.
      releaseBackgroundRefreshes()
    } finally {
      vi.useRealTimers()
    }
  })
})
