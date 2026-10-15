// AI 작업 중 유령 버블(AiWorkingBubble) 상태 전이 — 채널·DM 페이지가 같은 규칙을 쓰도록 순수 함수로 모은다(WP-412).
// 예전엔 ChannelPage(A9)·DmPage(#345)에 같은 리듀서가 복제돼 있었다. 화면 배선은 useAiWorkingBubbles 훅이 맡는다.
import type { MessagingProgressEvent } from '@/hooks/useMessageStream'

/** streamId → 마지막 진행 이벤트 + 수신 시각(ms). TTL 스위프 기준이 수신 시각이다. */
export type WorkingEntry = MessagingProgressEvent & { at: number }
export type WorkingMap = Map<string, WorkingEntry>

/** 무수신 유령 버블 수명 — 60초. done 이벤트가 끝내 오지 않아도 버블이 영원히 남지 않게 하는 안전망. */
export const WORKING_TTL_MS = 60_000

/**
 * 진행 이벤트 하나를 반영한다 — done/error 는 버블 제거 + 종료 기록, 그 밖은 갱신.
 *
 * 종료된 streamId 의 뒤늦은 비종료 이벤트는 무시한다: ai-agent 가 progress 를 fire-and-forget POST 로
 * 보내 'done' 뒤에 'tool' 이 도착할 수 있고, 이를 받아들이면 답변이 이미 떠 있는데도 버블이 60초간 부활한다.
 * ended 는 호출자가 보관하는 집합이며 이 함수가 종료 streamId 를 추가한다.
 */
export function applyProgressEvent(
  prev: WorkingMap,
  ended: Set<string>,
  e: MessagingProgressEvent,
  now: number,
): WorkingMap {
  const next = new Map(prev)
  if (e.phase === 'done' || e.phase === 'error') {
    ended.add(e.streamId)
    next.delete(e.streamId)
  } else if (!ended.has(e.streamId)) {
    next.set(e.streamId, { ...e, at: now })
  }
  return next
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
export function sweepStaleWorking(prev: WorkingMap, now: number, ttl = WORKING_TTL_MS): WorkingMap {
  const cutoff = now - ttl
  const next = new Map([...prev].filter(([, v]) => v.at >= cutoff))
  return next.size === prev.size ? prev : next
}
