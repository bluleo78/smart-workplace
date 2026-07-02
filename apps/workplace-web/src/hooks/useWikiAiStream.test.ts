import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/wiki', () => ({
  wikiApi: {
    startAi: vi.fn(),
    cancelAi: vi.fn(),
  },
}))

import { wikiApi } from '../api/wiki'
import { emitAiStreamEvent } from '../lib/aiEventBus'
import { startWikiAiStream } from './useWikiAiStream'

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('startWikiAiStream', () => {
  beforeEach(() => {
    vi.mocked(wikiApi.startAi).mockReset()
    vi.mocked(wikiApi.cancelAi).mockReset()
  })

  it('시작 응답의 correlationId 로 델타/완료 이벤트를 필터링해 콜백에 전달한다', async () => {
    vi.mocked(wikiApi.startAi).mockResolvedValue({ data: { correlationId: 'corr-1' } } as never)
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    startWikiAiStream({ pageId: 1, action: 'summarize', onDelta, onDone, onError })
    await flush()

    emitAiStreamEvent('wiki.ai.delta', { correlationId: 'other', text: '무시됨' })
    emitAiStreamEvent('wiki.ai.delta', { correlationId: 'corr-1', text: '요약: ' })
    emitAiStreamEvent('wiki.ai.done', { correlationId: 'corr-1' })

    expect(onDelta).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenCalledWith('요약: ')
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('error 이벤트(cancelled 아님)는 onError 를 호출한다', async () => {
    vi.mocked(wikiApi.startAi).mockResolvedValue({ data: { correlationId: 'corr-2' } } as never)
    const onDone = vi.fn()
    const onError = vi.fn()

    startWikiAiStream({ pageId: 1, action: 'summarize', onDelta: vi.fn(), onDone, onError })
    await flush()

    emitAiStreamEvent('wiki.ai.error', { correlationId: 'corr-2', message: '실패' })

    expect(onError).toHaveBeenCalledWith('실패')
    expect(onDone).not.toHaveBeenCalled()
  })

  // abort() 를 호출하지 않은 상태에서 cancelled:true 이벤트가 도착하는 경우는 이 클라이언트가
  // 요청한 취소가 아니라 서버측 타임아웃(StreamingGenerationRegistry)뿐이다 — abort() 는 teardown()
  // 을 동기 호출해 리스너를 즉시 해제하므로 자기 자신이 요청한 취소의 echo 는 절대 받을 수 없다.
  // 따라서 이 경우 onError 로 사용자에게 알려 busy 상태가 영구히 멈추지 않도록 해야 한다.
  it('abort 하지 않은 상태의 cancelled error 이벤트(서버 타임아웃)는 onError 를 호출한다', async () => {
    vi.mocked(wikiApi.startAi).mockResolvedValue({ data: { correlationId: 'corr-3' } } as never)
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    startWikiAiStream({ pageId: 1, action: 'summarize', onDelta, onDone, onError })
    await flush()

    emitAiStreamEvent('wiki.ai.error', { correlationId: 'corr-3', cancelled: true })

    expect(onError).toHaveBeenCalledWith('생성 시간이 초과되었습니다.')
    expect(onDelta).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('abort() 는 취소 API 를 호출하고 이후 이벤트를 무시한다', async () => {
    vi.mocked(wikiApi.startAi).mockResolvedValue({ data: { correlationId: 'corr-4' } } as never)
    vi.mocked(wikiApi.cancelAi).mockResolvedValue({} as never)
    const onDelta = vi.fn()

    const handle = startWikiAiStream({
      pageId: 1,
      action: 'summarize',
      onDelta,
      onDone: vi.fn(),
      onError: vi.fn(),
    })
    await flush()
    handle.abort()

    expect(wikiApi.cancelAi).toHaveBeenCalledWith(1, 'corr-4')

    emitAiStreamEvent('wiki.ai.delta', { correlationId: 'corr-4', text: '늦게 도착' })
    expect(onDelta).not.toHaveBeenCalled()
  })
})
