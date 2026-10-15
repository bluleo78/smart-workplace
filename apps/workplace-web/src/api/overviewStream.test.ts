import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/drive', () => ({
  driveApi: {
    startOverview: vi.fn(),
    cancelOverview: vi.fn(),
  },
}))

import { driveApi } from '@/api/drive'
import { emitAiStreamEvent } from '@/lib/aiEventBus'

import { startDriveOverviewStream } from './overviewStream'

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('startDriveOverviewStream', () => {
  beforeEach(() => {
    vi.mocked(driveApi.startOverview).mockReset()
    vi.mocked(driveApi.cancelOverview).mockReset()
  })

  it('시작 응답의 correlationId 로 델타를 필터링해 누적하고 done 에서 종료한다', async () => {
    vi.mocked(driveApi.startOverview).mockResolvedValue({ data: { correlationId: 'corr-1' } } as never)
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    startDriveOverviewStream({ query: 'q', onDelta, onDone, onError })
    await flush()

    emitAiStreamEvent('drive.overview.delta', { correlationId: 'other', text: '무시됨' })
    emitAiStreamEvent('drive.overview.delta', { correlationId: 'corr-1', text: '요약: ' })
    emitAiStreamEvent('drive.overview.done', { correlationId: 'corr-1' })

    expect(onDelta).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenCalledWith('요약: ')
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('done 이후 구독이 해제되어 늦게 도착한 델타는 무시된다', async () => {
    vi.mocked(driveApi.startOverview).mockResolvedValue({ data: { correlationId: 'corr-done' } } as never)
    const onDelta = vi.fn()
    const onDone = vi.fn()

    startDriveOverviewStream({ query: 'q', onDelta, onDone, onError: vi.fn() })
    await flush()

    emitAiStreamEvent('drive.overview.done', { correlationId: 'corr-done' })
    expect(onDone).toHaveBeenCalledTimes(1)

    emitAiStreamEvent('drive.overview.delta', { correlationId: 'corr-done', text: '늦은 델타' })
    expect(onDelta).not.toHaveBeenCalled()
  })

  it('error 이벤트(cancelled:true)는 타임아웃 메시지로 onError 를 호출한다', async () => {
    vi.mocked(driveApi.startOverview).mockResolvedValue({ data: { correlationId: 'corr-2' } } as never)
    const onDone = vi.fn()
    const onError = vi.fn()

    startDriveOverviewStream({ query: 'q', onDelta: vi.fn(), onDone, onError })
    await flush()

    emitAiStreamEvent('drive.overview.error', { correlationId: 'corr-2', cancelled: true })

    expect(onError).toHaveBeenCalledWith('생성 시간이 초과되었습니다.')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('abort() 는 취소 API 를 호출하고 이후 이벤트를 무시한다', async () => {
    vi.mocked(driveApi.startOverview).mockResolvedValue({ data: { correlationId: 'corr-4' } } as never)
    vi.mocked(driveApi.cancelOverview).mockResolvedValue({} as never)
    const onDelta = vi.fn()

    const handle = startDriveOverviewStream({
      query: 'q',
      onDelta,
      onDone: vi.fn(),
      onError: vi.fn(),
    })
    await flush()
    handle.abort()

    expect(driveApi.cancelOverview).toHaveBeenCalledWith('corr-4')

    emitAiStreamEvent('drive.overview.delta', { correlationId: 'corr-4', text: '늦게 도착' })
    expect(onDelta).not.toHaveBeenCalled()
  })

  // #681 StrictMode(dev) 이중 mount — mount→cleanup(abort)→mount 가 같은 tick 에 일어나도 phantom 인스턴스는
  // 시작 요청도 취소 요청도 보내지 않는다. preview 빌드엔 StrictMode 가 없어 E2E 로는 검증되지 않던 경로(WP-410).
  it('같은 tick 에 시작→abort→재시작하면 시작 요청은 1회, 취소 요청은 0회다', async () => {
    vi.mocked(driveApi.startOverview).mockResolvedValue({ data: { correlationId: 'corr-sm' } } as never)

    const phantom = startDriveOverviewStream({ query: 'q', onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() })
    phantom.abort()
    startDriveOverviewStream({ query: 'q', onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() })
    await flush()

    expect(driveApi.startOverview).toHaveBeenCalledTimes(1)
    expect(driveApi.cancelOverview).not.toHaveBeenCalled()
  })

  // #681 SSE 유실(재연결 catch-up 미대상)로 done/error 가 오지 않으면 125초 클라이언트 타임아웃이 에러로 전환한다.
  describe('클라이언트 타임아웃', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('done/error 없이 125초가 지나면 타임아웃 에러로 끝나고, 늦은 done 은 무시된다', async () => {
      vi.mocked(driveApi.startOverview).mockResolvedValue({ data: { correlationId: 'corr-lost' } } as never)
      const onDone = vi.fn()
      const onError = vi.fn()

      startDriveOverviewStream({ query: 'q', onDelta: vi.fn(), onDone, onError })
      // 가짜 타이머에선 setTimeout(0) flush 가 멈추므로 마이크로태스크만 비운다(시작 응답 → 구독·타이머 등록).
      await vi.advanceTimersByTimeAsync(0)

      await vi.advanceTimersByTimeAsync(124_999)
      expect(onError).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith('생성 시간이 초과되었습니다.')

      emitAiStreamEvent('drive.overview.done', { correlationId: 'corr-lost' })
      expect(onDone).not.toHaveBeenCalled()
    })

    it('125초 전에 done 이 오면 타임아웃은 해제되어 에러가 나지 않는다', async () => {
      vi.mocked(driveApi.startOverview).mockResolvedValue({ data: { correlationId: 'corr-ok' } } as never)
      const onDone = vi.fn()
      const onError = vi.fn()

      startDriveOverviewStream({ query: 'q', onDelta: vi.fn(), onDone, onError })
      await vi.advanceTimersByTimeAsync(0)
      emitAiStreamEvent('drive.overview.done', { correlationId: 'corr-ok' })

      await vi.advanceTimersByTimeAsync(200_000)
      expect(onDone).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    })
  })
})
