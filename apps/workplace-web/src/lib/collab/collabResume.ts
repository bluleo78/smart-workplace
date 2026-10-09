/**
 * 모바일 복귀 처리(WP-293, 스펙 §7.2) 순수 규칙 — 백그라운드 자가 해제 시간, 자리 비운 동안 고친 사람 수, 토스트 여부.
 * 세션(collabSession)이 시각·state vector 를 넘기고 결과만 받는다(화면·소켓 없이 vitest).
 */

/** 백그라운드가 이만큼 넘으면 스스로 연결을 끊는다(배터리·데이터) — 스펙 "2분 초과". 모바일 셸에서만. */
export const BACKGROUND_DISCONNECT_MS = 2 * 60_000
/** 이만큼 넘게 비웠고 남의 수정이 있으면 돌아올 때 토스트 — 스펙 "2분 넘게". */
export const AWAY_TOAST_MS = 2 * 60_000
/** 돌아와 따라잡은 블록을 잠깐 하이라이트하는 시간(시안 mobile-ux ③ "잠깐 하이라이트"). */
export const CATCHUP_HIGHLIGHT_MS = 2000

/** Yjs state vector(clientID → 그 클라이언트의 다음 clock) — Y.decodeStateVector 결과. */
export type StateVector = Map<number, number>

/** 그사이 편집한 클라이언트들 — clock 이 늘었거나 새로 나타난 clientID. */
export function advancedClients(before: StateVector, after: StateVector): number[] {
  const out: number[] = []
  for (const [client, clock] of after) if (clock > (before.get(client) ?? 0)) out.push(client)
  return out
}

/**
 * 자리 비운 동안 고친 사람 수 — clientID 를 연결 중 모아 둔 표(clientID → userId)로 사람으로 바꿔 센다.
 * 나(같은 clientID)와 내 다른 탭(같은 userId)은 뺀다. 표에 없는 clientID(비운 사이 들어왔다 나간 사람·서버 AI 적용)는 각각 한 명.
 */
export function countAwayEditors(
  clients: number[],
  knownUsers: ReadonlyMap<number, number>,
  self: { clientId: number; userId: number | null },
): number {
  const people = new Set<string>()
  for (const c of clients) {
    if (c === self.clientId) continue
    const user = knownUsers.get(c)
    if (user != null && user === self.userId) continue
    people.add(user != null ? `u${user}` : `c${c}`)
  }
  return people.size
}

/** 돌아와 동기화를 마친 한 번의 결과 — seq 는 화면이 같은 결과를 두 번 처리하지 않게 하는 순번. */
export interface CollabResume {
  seq: number
  awayMs: number
  editors: number
}

/** "자리를 비운 동안 N명이 수정했어요" 토스트를 띄울지. */
export function shouldShowAwayToast(r: CollabResume | null): boolean {
  return r != null && r.awayMs > AWAY_TOAST_MS && r.editors > 0
}

/** 화면이 이미 처리한 복귀 — 어느 세션(owner)의 몇 번(seq)까지. */
export interface ResumeGate {
  owner: object
  seq: number
}

/**
 * 이 resume 을 지금 처리할지(토스트·하이라이트) 정하고 다음 게이트를 돌려준다. 중복 제거는 세션별이다.
 * - 같은 세션: seq 가 처리한 것보다 클 때만 한 번. ready=false(에디터 없음)면 소비하지 않고 기다린다.
 * - 세션이 바뀜(마운트된 화면에서 같은 페이지의 새 세션으로 renewal): 새 세션은 seq 를 1부터 다시 세므로 옛 세션의 seq 와 비교하면
 *   새 복귀가 조용히 묻힌다. 게이트를 새 세션으로 옮기고, 그 순간 이미 있던 resume 은 마운트 때와 같이 지난 복귀로 보고 건너뛴다.
 */
export function acceptResume(
  gate: ResumeGate,
  owner: object,
  resume: CollabResume | null,
  ready: boolean,
): { gate: ResumeGate; fire: boolean } {
  if (gate.owner !== owner) return { gate: { owner, seq: resume?.seq ?? 0 }, fire: false }
  if (!resume || !ready || resume.seq <= gate.seq) return { gate, fire: false }
  return { gate: { owner, seq: resume.seq }, fire: true }
}
