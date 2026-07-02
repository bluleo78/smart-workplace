import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
