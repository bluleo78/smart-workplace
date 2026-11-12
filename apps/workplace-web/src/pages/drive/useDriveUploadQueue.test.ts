// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeFile } from './uploadTestUtils'
import { useDriveUploadQueue } from './useDriveUploadQueue'

/** 배치를 올릴 자리 — 공간 1 의 폴더 1. */
const ROOT = { sid: 1, folderId: 1 }

/** 밖에서 해결/거절할 수 있는 약속. */
function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 마이크로태스크를 비워 훅의 비동기 루프가 진행되게 한다. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function setup(overrides: Partial<Parameters<typeof useDriveUploadQueue>[0]> = {}) {
  const upload = vi.fn(async () => undefined)
  // 폴더 이름 → id 고정 표(x=101, y=102) — 부모는 호출 기록으로 본다.
  const resolveFolder = vi.fn(async (_root: unknown, _parent: number | null, name: string) => ({ x: 101, y: 102 })[name] ?? 999)
  const onSettled = vi.fn()
  const hook = renderHook(() =>
    useDriveUploadQueue({
      upload: upload as never,
      resolveFolder,
      onSettled,
      ...overrides,
    }),
  )
  return { ...hook, upload, resolveFolder, onSettled }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useDriveUploadQueue', () => {
  it('파일별 진행률이 batch 에 반영된다', async () => {
    const d = deferred()
    const upload = vi.fn(
      async (_r: unknown, _f: number | null, _file: File, _s: AbortSignal, onProgress: (p: number) => void) => {
        onProgress(42)
        await d.promise
      },
    )
    const { result } = setup({ upload: upload as never })
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    expect(result.current.batch?.items[0].status).toBe('uploading')
    expect(result.current.batch?.items[0].percent).toBe(42)
    expect(result.current.busy).toBe(true)
    d.resolve(undefined)
    await flush()
    expect(result.current.batch?.items[0].status).toBe('done')
    expect(result.current.busy).toBe(false)
  })

  it('크기 초과는 upload 를 부르지 않고 retryable=false 실패', async () => {
    const { result, upload } = setup()
    act(() => {
      result.current.start([{ file: makeFile('big.pdf', 101 * 1024 * 1024), path: [] }], ROOT)
    })
    await flush()
    const item = result.current.batch!.items[0]
    expect(upload).not.toHaveBeenCalled()
    expect(item.status).toBe('failed')
    expect(item.retryable).toBe(false)
    expect(item.error).toContain('초과')
  })

  it('서버 실패는 이유를 남기고 다음 파일을 계속 올린다', async () => {
    const upload = vi.fn(async (_r: unknown, _f: number | null, file: File) => {
      if (file.name === 'a.txt') throw new Error('boom')
    })
    const { result } = setup({ upload: upload as never })
    act(() => {
      result.current.start([
        { file: makeFile('a.txt'), path: [] },
        { file: makeFile('b.txt'), path: [] },
      ], ROOT)
    })
    await flush()
    const [a, b] = result.current.batch!.items
    expect(a.status).toBe('failed')
    expect(a.error).toBeTruthy()
    expect(a.retryable).toBe(true)
    expect(b.status).toBe('done')
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('cancel 은 진행 중 요청 signal 을 abort 하고 남은 파일을 올리지 않는다', async () => {
    const d = deferred()
    let signal!: AbortSignal
    const upload = vi.fn(async (_r: unknown, _f: number | null, _file: File, s: AbortSignal) => {
      signal = s
      await d.promise
    })
    const { result } = setup({ upload: upload as never })
    act(() => {
      result.current.start([
        { file: makeFile('a.txt'), path: [] },
        { file: makeFile('b.txt'), path: [] },
      ], ROOT)
    })
    await flush()
    act(() => result.current.cancel())
    expect(signal.aborted).toBe(true)
    d.reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', name: 'CanceledError' }))
    await flush()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(result.current.batch?.cancelled).toBe(true)
    expect(result.current.batch?.items.map((i) => i.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('취소 뒤 늦게 끝난 요청은 행을 완료로 바꾸지 않는다', async () => {
    const d = deferred()
    const upload = vi.fn(async () => {
      await d.promise
    })
    const { result } = setup({ upload: upload as never })
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    act(() => result.current.cancel())
    d.resolve(undefined)
    await flush()
    expect(result.current.batch?.items[0].status).toBe('cancelled')
    expect(result.current.batch?.running).toBe(false)
  })

  it('start 는 진행 중이면 false 를 돌려주고 아무것도 하지 않는다', async () => {
    const d = deferred()
    const upload = vi.fn(async () => {
      await d.promise
    })
    const { result } = setup({ upload: upload as never })
    let first = false
    let second = true
    act(() => {
      first = result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
      second = result.current.start([{ file: makeFile('b.txt'), path: [] }], ROOT)
    })
    await flush()
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(result.current.batch?.items).toHaveLength(1)
    expect(upload).toHaveBeenCalledTimes(1)
    d.resolve(undefined)
    await flush()
  })

  it('retry 는 실패 파일만 원래 폴더로 다시 올린다', async () => {
    let failB = true
    const upload = vi.fn(async (_r: unknown, _f: number | null, file: File) => {
      if (file.name === 'b.txt' && failB) throw new Error('boom')
    })
    const { result } = setup({ upload: upload as never })
    act(() => {
      result.current.start([
        { file: makeFile('a.txt'), path: [] },
        { file: makeFile('b.txt'), path: ['x', 'y'] },
      ], ROOT)
    })
    await flush()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[1][1]).toBe(102)
    failB = false
    act(() => result.current.retry('1'))
    expect(result.current.busy).toBe(true)
    await flush()
    expect(upload).toHaveBeenCalledTimes(3)
    expect(upload.mock.calls[2][1]).toBe(102)
    expect(upload.mock.calls[2][2].name).toBe('b.txt')
    expect(result.current.batch?.items.map((i) => i.status)).toEqual(['done', 'done'])
    expect(result.current.busy).toBe(false)
  })

  // 경로 → 폴더 id 캐시는 훅 하나뿐 — 부모부터 한 번씩만 만들고, 빈 경로는 start 때 받은 루트 폴더다(무한 재귀 없음).
  it('하위 경로는 부모부터 한 번씩만 만들고 시작 폴더를 루트로 쓴다', async () => {
    const { result, upload, resolveFolder } = setup()
    act(() => {
      result.current.start(
        [
          { file: makeFile('a.txt'), path: ['x', 'y'] },
          { file: makeFile('b.txt'), path: ['x'] },
          { file: makeFile('c.txt'), path: [] },
        ],
        { sid: 1, folderId: 7 },
      )
    })
    await flush()
    // 콜백은 배치의 자리(root)를 함께 받는다
    expect(resolveFolder.mock.calls).toEqual([
      [{ sid: 1, folderId: 7 }, 7, 'x'],
      [{ sid: 1, folderId: 7 }, 101, 'y'],
    ])
    expect((upload.mock.calls as unknown as unknown[][]).map((c) => c[1])).toEqual([102, 101, 7])
  })

  it('retry 는 실패하지 않았거나 다시 시도 불가인 행은 무시한다', async () => {
    const { result, upload } = setup()
    act(() => {
      result.current.start([
        { file: makeFile('a.txt'), path: [] },
        { file: makeFile('big.pdf', 101 * 1024 * 1024), path: [] },
      ], ROOT)
    })
    await flush()
    act(() => result.current.retry('0'))
    act(() => result.current.retry('1'))
    await flush()
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('resolveFolder 가 실패하면 그 파일을 실패로 두고 계속한다', async () => {
    const resolveFolder = vi.fn(async () => {
      throw new Error('폴더 실패')
    })
    const { result, upload } = setup({ resolveFolder })
    act(() => {
      result.current.start([
        { file: makeFile('a.txt'), path: ['x'] },
        { file: makeFile('b.txt'), path: [] },
      ], ROOT)
    })
    await flush()
    expect(result.current.batch?.items.map((i) => i.status)).toEqual(['failed', 'done'])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('모두 성공하면 5초 뒤 batch 가 null', async () => {
    vi.useFakeTimers()
    const { result } = setup()
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    expect(result.current.batch?.items[0].status).toBe('done')
    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(result.current.batch).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.batch).toBeNull()
  })

  it('5초 전에 새 start 를 하면 새 배치가 닫히지 않는다', async () => {
    vi.useFakeTimers()
    const d = deferred()
    let n = 0
    const upload = vi.fn(async () => {
      n += 1
      if (n === 2) await d.promise
    })
    const { result } = setup({ upload: upload as never })
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    act(() => {
      result.current.start([{ file: makeFile('b.txt'), path: [] }], ROOT)
    })
    await flush()
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(result.current.batch).not.toBeNull()
    expect(result.current.busy).toBe(true)
    d.resolve(undefined)
    await flush()
  })

  it('close 는 배치를 지우고 타이머를 정리한다', async () => {
    vi.useFakeTimers()
    const { result } = setup()
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    act(() => result.current.close())
    expect(result.current.batch).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  // 패널은 끝난 뒤에만 닫기를 보이지만, 훅은 그 규칙에 기대지 않는다 — 닫힌 배치의 요청이 뒤에서 계속 돌면 안 된다.
  it('close 는 올리는 중이면 요청을 끊는다', async () => {
    const d = deferred()
    let signal!: AbortSignal
    const upload = vi.fn(async (_r: unknown, _f: number | null, _file: File, s: AbortSignal) => {
      signal = s
      await d.promise
    })
    const { result } = setup({ upload: upload as never })
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    act(() => result.current.close())
    expect(signal.aborted).toBe(true)
    expect(result.current.batch).toBeNull()
    // 끊긴 뒤엔 새 배치를 시작할 수 있다
    let started = false
    act(() => {
      started = result.current.start([{ file: makeFile('b.txt'), path: [] }], ROOT)
    })
    expect(started).toBe(true)
    d.resolve(undefined)
    await flush()
  })

  // 예전 업로드처럼 다른 메뉴로 나가거나 서랍을 닫아도 시작한 배치는 끝까지 간다 — 끝나면 onSettled 로 사용량·목록 캐시를 갱신한다.
  it('화면을 떠나도 업로드는 끝까지 가고 onSettled 가 불린다', async () => {
    const d = deferred()
    let signal!: AbortSignal
    const upload = vi.fn(async (_r: unknown, _f: number | null, _file: File, s: AbortSignal) => {
      signal = s
      await d.promise
    })
    const { result, unmount, onSettled } = setup({ upload: upload as never })
    act(() => {
      result.current.start([
        { file: makeFile('a.txt'), path: [] },
        { file: makeFile('b.txt'), path: [] },
      ], ROOT)
    })
    await flush()
    unmount()
    expect(signal.aborted).toBe(false)
    d.resolve(undefined)
    await flush()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(onSettled).toHaveBeenCalledWith(ROOT)
  })

  // 처음 실행은 실패만 있어도 늘 onSettled(놓으며 만든 폴더 반영), 다시 시도는 무언가 올라갔을 때만.
  it('onSettled 는 처음 실행엔 늘, 다시 시도엔 성공이 있을 때만 배치 자리로 불린다', async () => {
    let fail = 2
    const upload = vi.fn(async () => {
      if (fail-- > 0) throw new Error('boom')
    })
    const { result, onSettled } = setup({ upload: upload as never })
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenLastCalledWith(ROOT)
    // 다시 시도도 실패 — 부르지 않는다
    act(() => result.current.retry('0'))
    await flush()
    expect(onSettled).toHaveBeenCalledTimes(1)
    // 다시 시도 성공 — 부른다
    act(() => result.current.retry('0'))
    await flush()
    expect(onSettled).toHaveBeenCalledTimes(2)
    expect(result.current.batch?.items[0].status).toBe('done')
  })

  it('진행률은 정수 퍼센트가 바뀔 때만 다시 그린다', async () => {
    const d = deferred()
    let report!: (p: number) => void
    const upload = vi.fn(async (_r: unknown, _f: number | null, _file: File, _s: AbortSignal, onProgress: (p: number) => void) => {
      report = onProgress
      await d.promise
    })
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useDriveUploadQueue({ upload: upload as never, resolveFolder: vi.fn(), onSettled: vi.fn() })
    })
    act(() => {
      result.current.start([{ file: makeFile('a.txt'), path: [] }], ROOT)
    })
    await flush()
    act(() => report(10))
    const after10 = renders
    act(() => {
      report(10)
      report(10)
    })
    expect(renders).toBe(after10)
    act(() => report(11))
    expect(renders).toBeGreaterThan(after10)
    expect(result.current.batch?.items[0].percent).toBe(11)
    d.resolve(undefined)
    await flush()
  })
})
