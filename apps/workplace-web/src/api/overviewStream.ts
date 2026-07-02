// AI Overview 생성 시작(correlationId 즉시 반환) → 통합 /events 채널(aiEventBus 로 중계)에서
// correlationId 로 필터링해 델타/완료/에러를 수신한다(#593 편입, useWikiAiStream.ts 미러).
// 구독은 생성이 진행 중인 동안만 열려 있다가 done/error/abort 시 즉시 해제한다.
import { driveApi } from '@/api/drive'
import { onAiStreamEvent } from '@/lib/aiEventBus'

export interface DriveOverviewStreamArgs {
  query: string
  /** 근거를 해당 공간으로 제한(콘텐츠 검색과 스코프 일관성 유지). 생략 시 테넌트 전역. */
  spaceId?: number
  onDelta: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
}

interface DeltaPayload {
  correlationId?: string
  text?: string
}
interface DonePayload {
  correlationId?: string
}
interface ErrorPayload {
  correlationId?: string
  message?: string
  cancelled?: boolean
}

/** Overview 생성을 시작하고 즉시 { abort } 를 반환한다. 시작 요청·구독은 inner async IIFE 에서 진행. */
export function startDriveOverviewStream(args: DriveOverviewStreamArgs): { abort: () => void } {
  const { query, spaceId, onDelta, onDone, onError } = args
  let aborted = false
  let startedCorrelationId: string | null = null
  let unsubscribeDelta: (() => void) | null = null
  let unsubscribeDone: (() => void) | null = null
  let unsubscribeError: (() => void) | null = null

  const teardown = () => {
    unsubscribeDelta?.()
    unsubscribeDone?.()
    unsubscribeError?.()
    unsubscribeDelta = unsubscribeDone = unsubscribeError = null
  }

  void (async () => {
    let correlationId: string
    try {
      const res = await driveApi.startOverview(query, spaceId)
      correlationId = res.data.correlationId
    } catch {
      if (!aborted) onError('AI Overview 생성 시작에 실패했습니다.')
      return
    }

    if (aborted) {
      // abort() 가 시작 응답보다 먼저 호출됐다 — 서버에 즉시 취소 요청.
      void driveApi.cancelOverview(correlationId).catch(() => {})
      return
    }
    startedCorrelationId = correlationId

    unsubscribeDelta = onAiStreamEvent('drive.overview.delta', (data) => {
      const p = data as DeltaPayload
      if (p.correlationId !== correlationId || typeof p.text !== 'string') return
      onDelta(p.text)
    })
    unsubscribeDone = onAiStreamEvent('drive.overview.done', (data) => {
      const p = data as DonePayload
      if (p.correlationId !== correlationId) return
      teardown()
      onDone()
    })
    unsubscribeError = onAiStreamEvent('drive.overview.error', (data) => {
      const p = data as ErrorPayload
      if (p.correlationId !== correlationId) return
      teardown()
      // abort() 는 항상 네트워크 취소 요청 전에 teardown() 으로 구독을 동기 해제하므로, 살아있는
      // 구독이 cancelled:true 를 받았다는 것 자체가 이 클라이언트의 취소가 아니라 서버측
      // StreamingGenerationRegistry 타임아웃(120초)이라는 뜻이다(useWikiAiStream.ts 와 동일 추론).
      if (p.cancelled) {
        onError('생성 시간이 초과되었습니다.')
      } else {
        onError(p.message ?? 'AI Overview 생성 중 오류가 발생했습니다.')
      }
    })
  })()

  return {
    abort: () => {
      aborted = true
      teardown()
      if (startedCorrelationId) {
        void driveApi.cancelOverview(startedCorrelationId).catch(() => {})
      }
    },
  }
}
