import {
  COLLAB_AI_APPLY_ACK_TYPE,
  COLLAB_AI_APPLY_TYPE,
  COLLAB_AI_CANCEL_TYPE,
  type CollabAiApplyMessage,
  parseCollabAiMessage,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'

/**
 * 에디터 안 AI 결과를 넣기 직전의 동기화 서버 알림(WP-323).
 * AI 결과를 문서에 넣기 전에 ai-apply 를 보내 동기화 서버가 미저장 사람 편집을 먼저 저장하고 AI 태그를 달게 한 뒤,
 * ack(또는 시간 초과)를 기다린다 — 그래야 AI 직전 판이 버전 기록에 ✦ 로 남는다. 화면 없이 vitest 로 검증하는 순수 모듈.
 */

/** ack 대기 상한 — 동기화 서버의 적용 저장 하한(APPLY_STORE_MIN_MS)과 같은 값. 넘으면 ✦ 보장 없이 그냥 넣는다(옛 collab·끊김). */
export const AI_APPLY_ACK_TIMEOUT_MS = 3000

/** 핸드셰이크가 쓰는 provider 의 최소 면 — HocuspocusProvider 가 그대로 맞고, 테스트는 가짜로 바꿔 끼운다. */
export interface AiApplyProvider {
  /** 첫 동기화(핸드셰이크)를 마쳤는지 — 끊기면 provider 가 false 로 되돌린다. */
  isSynced: boolean
  /** 서버가 허락한 범위 — 'readonly' 면 서버가 ai-apply 를 무시하므로(ack 없음) 보내지 않는다. */
  authorizedScope?: string
  configuration: { websocketProvider?: { status?: string } }
  sendStateless(payload: string): void
  on(event: 'stateless', fn: (e: { payload: string }) => void): unknown
  off(event: 'stateless', fn: (e: { payload: string }) => void): unknown
}

/**
 * 핸드셰이크 결과 — acked 면 서버가 직전 판 저장·태그를 마쳤다. 넣을지 말지는 commit 이 정한다(호출자는 정책 없이 UI 상태만 다룬다).
 */
export interface AiApplyHandle {
  acked: boolean
  /**
   * 중단되지 않았고 canInsert 가 참이면 insert 를 부르고 true. 아니면 넣지 않고 서버의 AI 태그를 지운다(ai-cancel) — false.
   * ack 없이(시간 초과) 넣을 때도 넣기 전에 ai-cancel 을 먼저 보낸다 — 서버가 늦게 단 태그가 남으면 이 삽입과 무관한 다음 사람 저장에
   * 거짓 ✦ 가 붙는다(같은 소켓이라 취소가 삽입보다 먼저 처리된다). ai-apply 를 보내지 않았으면 취소도 보내지 않는다.
   */
  commit(insert: () => void): boolean
}

/** 지금 보내면 서버가 받아 답할 수 있는 상태인지 — 연결·동기화됐고 읽기 전용이 아님. */
// collabSession 의 serverReadOnly 와 공유하지 않는다 — 강등 때 둘이 다른 시점에 바뀌고, 서버가 답할지는 authorizedScope 가 맞다.
function isReady(provider: AiApplyProvider): boolean {
  return (
    provider.configuration.websocketProvider?.status === 'connected' &&
    provider.isSynced &&
    provider.authorizedScope !== 'readonly'
  )
}

/**
 * ai-apply 를 보내고 이 요청의 ack 를 기다린다(최대 timeoutMs).
 * 넣을 수 없거나(canInsert 거짓)·이미 중단됐거나·준비 안 됨(미연결·첫 동기화 전·읽기 전용)이면 보내지 않고 즉시 {acked:false}.
 * signal 이 중단되면 기다림을 바로 끝낸다(사용자 취소·다음 액션·언마운트 — commit 이 넣지 않고 취소를 보낸다).
 * provider 는 getProvider 로 읽는다 — ack 리스너는 보낸 provider 에 걸고 거두며, 취소는 그때의 provider 로 보낸다
 * (기다리는 사이 세션이 바뀌어도 서버에 닿게 — 서버는 연결이 아니라 문서·사용자·요청으로 짝짓는다).
 */
export function requestAiApply(
  getProvider: () => AiApplyProvider,
  opts: { canInsert?: () => boolean; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AiApplyHandle> {
  const { canInsert = () => true, signal, timeoutMs = AI_APPLY_ACK_TIMEOUT_MS } = opts
  const provider = getProvider()
  const sent = !signal?.aborted && canInsert() && isReady(provider)
  const requestId = sent ? crypto.randomUUID() : ''

  let cancelled = false
  const cancel = () => {
    if (!sent || cancelled) return
    cancelled = true
    const msg: CollabAiApplyMessage = { type: COLLAB_AI_CANCEL_TYPE, requestId }
    getProvider().sendStateless(JSON.stringify(msg))
  }
  const handle = (acked: boolean): AiApplyHandle => ({
    acked,
    commit: (insert) => {
      if (signal?.aborted || !canInsert()) {
        cancel()
        return false
      }
      if (!acked) cancel()
      insert()
      return true
    },
  })
  if (!sent) return Promise.resolve(handle(false))

  return new Promise<AiApplyHandle>((resolve) => {
    const finish = (acked: boolean) => {
      clearTimeout(timer)
      provider.off('stateless', onStateless)
      signal?.removeEventListener('abort', onAbort)
      resolve(handle(acked))
    }
    const onStateless = ({ payload }: { payload: string }) => {
      const msg = parseCollabAiMessage(payload)
      if (msg?.type === COLLAB_AI_APPLY_ACK_TYPE && msg.requestId === requestId) finish(true)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    // 리스너를 먼저 건다 — 응답이 보내는 즉시(동기) 와도 놓치지 않게.
    provider.on('stateless', onStateless)
    signal?.addEventListener('abort', onAbort)
    const msg: CollabAiApplyMessage = { type: COLLAB_AI_APPLY_TYPE, requestId }
    provider.sendStateless(JSON.stringify(msg))
  })
}
