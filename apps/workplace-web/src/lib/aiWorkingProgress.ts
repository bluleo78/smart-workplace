// AI 작업 중 유령 버블(AiWorkingBubble) 상태 전이 — 채널·DM·이슈 채팅이 같은 규칙을 쓰도록 순수 함수로 모은다(WP-412, WP-418).
// 예전엔 ChannelPage(A9)·DmPage(#345)·IssueChatSection 에 같은 리듀서가 복제돼 있었고, 이슈 채팅 사본만 고친 결함이 남았다.
// 화면 배선은 useAiWorkingBubbles 훅이 맡는다.

/**
 * 진행 이벤트가 상태 전이에 필요한 최소 모양 — 채널 이벤트(MessagingProgressEvent)와 이슈 채팅 이벤트(ChatProgressEvent)가
 * 모두 만족한다. 나머지 필드(agentName·steps·channelId/threadId)는 그대로 실려 화면이 쓴다.
 */
export interface ProgressEventLike {
  streamId: string
  phase: 'started' | 'tool' | 'done' | 'error'
}

/** streamId → 마지막 진행 이벤트 + 수신 시각(ms). TTL 스위프 기준이 수신 시각이다. */
export type WorkingEntry<E extends ProgressEventLike = ProgressEventLike> = E & { at: number }
export type WorkingMap<E extends ProgressEventLike = ProgressEventLike> = Map<string, WorkingEntry<E>>

/**
 * 대화방 하나의 진행 이벤트 구독 함수 — 해당 key 의 이벤트만 listener 로 넘기고 해지 함수를 돌려준다.
 * effect 의존성에 들어가므로 모듈 수준 함수(onChannelProgress·onThreadProgress)처럼 참조가 안정적이어야 한다.
 */
export type ProgressSubscribe<E extends ProgressEventLike> = (
  key: number,
  listener: (e: E) => void,
) => () => void

/**
 * 전역 진행 이벤트 버스(subscribeAll)를 대화방 하나로 거르는 ProgressSubscribe 를 만든다.
 * 채널(channelId)·이슈 채팅(threadId)이 "전역 버스를 key 로 거르기"를 각자 복제하지 않게 한 곳에 둔다.
 * 모듈 수준에서 한 번 만들어 export 하면 참조가 안정적이라 effect 의존성에 그대로 넣을 수 있다.
 */
export function keyedSubscribe<E extends ProgressEventLike>(
  subscribeAll: (listener: (e: E) => void) => () => void,
  pick: (e: E) => number,
): ProgressSubscribe<E> {
  return (key, listener) =>
    subscribeAll((e) => {
      if (pick(e) === key) listener(e)
    })
}

/** 무수신 유령 버블 수명 — 60초. done 이벤트가 끝내 오지 않아도 버블이 영원히 남지 않게 하는 안전망. */
export const WORKING_TTL_MS = 60_000

/**
 * 진행 이벤트 하나를 반영한다 — done/error 는 버블 제거 + 종료 기록, 그 밖은 갱신.
 *
 * 종료된 streamId 의 뒤늦은 비종료 이벤트는 무시한다: ai-agent 가 progress 를 fire-and-forget POST 로
 * 보내 'done' 뒤에 'tool' 이 도착할 수 있고, 이를 받아들이면 답변이 이미 떠 있는데도 버블이 60초간 부활한다.
 * ended 는 호출자가 보관하는 집합이며 이 함수가 종료 streamId 를 추가한다.
 */
export function applyProgressEvent<E extends ProgressEventLike>(
  prev: WorkingMap<E>,
  ended: Set<string>,
  e: E,
  now: number,
): WorkingMap<E> {
  if (e.phase === 'done' || e.phase === 'error') {
    ended.add(e.streamId)
    const next = new Map(prev)
    next.delete(e.streamId)
    return next
  }
  // 종료된 스트림의 뒤늦은 이벤트는 무시 — 같은 참조를 돌려 불필요한 리렌더를 막는다.
  if (ended.has(e.streamId)) return prev
  return new Map(prev).set(e.streamId, { ...e, at: now })
}

/** 목록에서 가장 큰 AGENT 메시지 id(없으면 0). message.id 는 서버 단조 증가 시퀀스라 "새 AI 답변 도착" 판정 기준이 된다. */
export function maxAgentMessageId(messages: { id: number; authorKind?: string | null }[]): number {
  return messages.reduce((mx, m) => (m.authorKind === 'AGENT' && m.id > mx ? m.id : mx), 0)
}

/**
 * AGENT 기준선 갱신 — 새 AI 답변이 도착했으면 모든 버블을 지운다(done 누락·순서 역전 대비 백스톱, #346).
 *
 * - 첫 로드(baseline=null)는 기준선만 잡고 지우지 않는다 — 진입 시 이미 진행 중인 버블 보호.
 * - 기준선 초과 AGENT id 만 "신규 도착"으로 본다 → 스크롤백(과거 작은 id prepend)·HUMAN 메시지·낙관적 임시 id 는 버블을 지우지 않는다.
 */
export function nextAgentBaseline(
  baseline: number | null,
  maxAgentId: number,
): { baseline: number; clear: boolean } {
  if (baseline === null) return { baseline: maxAgentId, clear: false }
  if (maxAgentId > baseline) return { baseline: maxAgentId, clear: true }
  return { baseline, clear: false }
}

/** TTL 스위프 — 마지막 수신이 ttl 보다 오래된 버블을 뺀다. 바뀐 게 없으면 같은 참조를 돌려 불필요한 리렌더를 막는다. */
export function sweepStaleWorking<E extends ProgressEventLike>(
  prev: WorkingMap<E>,
  now: number,
  ttl = WORKING_TTL_MS,
): WorkingMap<E> {
  const cutoff = now - ttl
  const next = new Map([...prev].filter(([, v]) => v.at >= cutoff))
  return next.size === prev.size ? prev : next
}
