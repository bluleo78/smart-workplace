// 위키 인에디터 /ai 토큰 스트리밍(#593 편입) — POST 로 생성을 시작해 correlationId 를 받고, 실제 델타는
// 통합 /events 채널(aiEventBus 로 중계됨)에서 correlationId 로 필터링해 수신한다. 구독은 생성이 진행 중인
// 동안만 열려 있다가 done/error/abort 시 즉시 해제한다(받은 이벤트를 버리는 게 아니라 받을 필요가 없는
// 동안은 애초에 구독하지 않는 원칙).

import { wikiApi } from '../api/wiki'
import { onAiStreamEvent } from '../lib/aiEventBus'

export interface WikiAiStreamArgs {
  pageId: number
  action:
    | 'summarize'
    | 'draft'
    | 'continue'
    | 'rewrite_tone'
    | 'translate'
    | 'expand'
    | 'condense'
    | 'polish'
  prompt?: string
  selection?: string
  // 토큰 델타 1개 — 커서 위치에 즉시 삽입.
  onDelta: (text: string) => void
  // 정상 종료(done 이벤트) — 자동저장 디바운스가 이어받는다.
  onDone: () => void
  // 에러(error 이벤트/네트워크/HTTP 실패, cancelled 는 제외) — 토스트 + 생성 중단.
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

/** /ai 생성을 시작하고 즉시 { abort } 를 반환한다. 시작 요청·구독은 inner async IIFE 에서 진행. */
export function startWikiAiStream(args: WikiAiStreamArgs): { abort: () => void } {
  const { pageId, action, prompt, selection, onDelta, onDone, onError } = args
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
      const res = await wikiApi.startAi(pageId, { action, prompt, selection })
      correlationId = res.data.correlationId
    } catch {
      if (!aborted) onError('AI 생성 시작에 실패했습니다.')
      return
    }

    if (aborted) {
      // abort() 가 시작 응답보다 먼저 호출됐다 — 서버에 즉시 취소 요청.
      void wikiApi.cancelAi(pageId, correlationId).catch(() => {})
      return
    }
    startedCorrelationId = correlationId

    unsubscribeDelta = onAiStreamEvent('wiki.ai.delta', (data) => {
      const p = data as DeltaPayload
      if (p.correlationId !== correlationId || typeof p.text !== 'string') return
      onDelta(p.text)
    })
    unsubscribeDone = onAiStreamEvent('wiki.ai.done', (data) => {
      const p = data as DonePayload
      if (p.correlationId !== correlationId) return
      teardown()
      onDone()
    })
    unsubscribeError = onAiStreamEvent('wiki.ai.error', (data) => {
      const p = data as ErrorPayload
      if (p.correlationId !== correlationId) return
      teardown()
      // 이 리스너는 abort() 시 teardown() 으로 즉시 해제되므로, 여기서 cancelled:true 를
      // 수신했다는 것 자체가 "이 클라이언트가 요청한 취소가 아니다"라는 뜻이다 — 즉 서버측
      // StreamingGenerationRegistry 의 120초 타임아웃이 생성 태스크를 동일한 방식(Future.cancel)
      // 으로 중단시킨 경우다. 조용히 삼키면 편집기의 "생성 중…" 상태가 영구히 멈추므로 반드시
      // onError 로 알려 busy 상태를 해제한다.
      if (p.cancelled) {
        onError('생성 시간이 초과되었습니다.')
      } else {
        onError(p.message ?? 'AI 생성 중 오류가 발생했습니다.')
      }
    })
  })()

  return {
    abort: () => {
      aborted = true
      teardown()
      if (startedCorrelationId) {
        void wikiApi.cancelAi(pageId, startedCorrelationId).catch(() => {})
      }
    },
  }
}
