import { COLLAB_ROLE_CHANGED_TYPE, isCollabEditRole } from '@smart-workplace/wiki-editor-schema/collab-protocol'

/**
 * 노트 동시 편집의 헤더 동기화 상태 판정 — 전부 순수 함수라 화면 없이 vitest 로 검증한다.
 * 세션(collabSession)이 모은 연결 사실을 받아 칩 하나로 줄이는 것까지만 하고, 표시 문구는 화면(Task 8)이 정한다.
 */

/**
 * 헤더 동기화 상태 — 정상은 'live'(점 하나), 문제 있을 때만 글자 칩.
 * 'forbidden' 은 접근 권한이 사라졌거나, 삭제 여부를 모르는 채 거절된 종단 상태다.
 * 'deleted' 는 이 노트가 삭제된 종단 상태다(서버가 삭제임을 확실히 알 때만 — 4404).
 * 'signed-out' 은 로그인이 풀려(refresh 거절) 다시 로그인하기 전엔 붙을 수 없는 종단 상태다.
 * 'outdated' 는 동기화 서버가 다른 스키마 판으로 배포돼(WP-313) 새로고침 전엔 붙을 수 없는 종단 상태다.
 * 'connecting' 은 새 세션이 아직 한 번도 동기화되지 않은 처음 연결 중(중립) — 끊김 경고(재연결 중)도, 권한 로딩 중의
 * 거짓 '읽기 전용'도 아니다. 이 동안 화면은 본문 대신 skeleton 을 보인다.
 */
export type SyncStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'unsent'
  | 'readonly'
  | 'forbidden'
  | 'deleted'
  | 'signed-out'
  | 'outdated'

/** 이 노트에 더 접근할 수 없는 종료 상태(삭제됨·접근 불가) — 노트를 바꾸는 동작·재시도 대신 나갈 길만 남긴다. */
export function isAccessLost(s: SyncStatus): boolean {
  return s === 'deleted' || s === 'forbidden'
}

// 잠깐 끊김(재연결 중)과 오프라인을 가르는 기준 — 짧은 네트워크 흔들림에 '오프라인'을 띄우지 않는다.
export const OFFLINE_AFTER_MS = 5000

/**
 * 재연결하지 않는 종단 상태 — 세션에 하나만 있다(먼저 닿은 것).
 * - forbidden: 접근 권한 사라짐, 또는 삭제 여부를 모르는 거절(4403·연결 시 인증 거절 등).
 * - deleted: 페이지 삭제(4404) — 남은 입력을 보낼 곳이 없다.
 * - authLost: 로그인 풀림(refresh 쿠키 거절) — 다시 로그인하기 전엔 붙을 수 없다.
 * - schemaStale: 동기화 서버가 다른 스키마 판으로 배포됨(WP-313) — 새로고침 전엔 붙을 수 없고, 아직 못 보낸 입력은 저장되지 않는다.
 */
export type CollabTerminal = 'forbidden' | 'deleted' | 'authLost' | 'schemaStale'

/** 종단 → 칩 상태. */
const TERMINAL_STATUS: Record<CollabTerminal, SyncStatus> = {
  forbidden: 'forbidden',
  deleted: 'deleted',
  authLost: 'signed-out',
  schemaStale: 'outdated',
}

/** 종단 칩 상태 모음 — TERMINAL_STATUS 의 값. */
const TERMINAL_STATUSES: ReadonlySet<SyncStatus> = new Set(Object.values(TERMINAL_STATUS))

/** 다시 붙지 않는 종단 상태인지 — 접속자 아바타·원격 커서·✦ 를 즉시 숨긴다(WP-173, awareness 30초 만료를 기다리지 않음). */
export function isTerminalStatus(s: SyncStatus): boolean {
  return TERMINAL_STATUSES.has(s)
}

/**
 * 상태 판정. 우선순위: 종단(outdated·signed-out·forbidden·deleted) → 첫 동기화 전이면 connecting(5초 넘으면 offline) → readonly → 연결됨이면 live → 미전송 있으면 unsent
 * → 끊긴 지 5초 미만 reconnecting → 그 외 offline.
 * 연결된 동안의 미전송(서버 확인 대기 중인 방금 입력)은 정상 흐름이라 live 로 본다.
 */
export function deriveSyncStatus(i: {
  connected: boolean
  disconnectedForMs: number
  unsynced: boolean
  readOnly: boolean
  /** 종단 상태(없으면 null·생략). */
  terminal?: CollabTerminal | null
  /** 이 세션이 한 번이라도 동기화를 마쳤는지. 생략하면 마친 것으로 본다. */
  everSynced?: boolean
}): SyncStatus {
  // 종단이 먼저 — 다시 붙지 않으므로 사용자가 할 일(새로고침·다시 로그인)이나 접근 불가를 알려야 한다.
  if (i.terminal) return TERMINAL_STATUS[i.terminal]
  // 처음 붙는 중엔 역할(readonly)도 아직 서버에게 못 들었다 — 화면 권한 로딩 탓의 '읽기 전용'을 띄우지 않는다.
  if (i.everSynced === false) return i.disconnectedForMs < OFFLINE_AFTER_MS ? 'connecting' : 'offline'
  if (i.readOnly) return 'readonly'
  if (i.connected) return 'live'
  if (i.unsynced) return 'unsent'
  return i.disconnectedForMs < OFFLINE_AFTER_MS ? 'reconnecting' : 'offline'
}

/**
 * 본문 자리에 무엇을 보일지 — 'ready' 본문 · 'loading' skeleton · 'unreachable' 연결 못 함 안내.
 * 첫 동기화 전엔 문서가 비어 있어 본문을 보이지 않는데, 첫 연결이 끝내 안 되면(동기화 서버 장애·인증 불러오기 실패)
 * skeleton 이 설명 없이 영영 남는다. 그래서 첫 연결 중 오프라인(새 세션은 만든 시각부터 끊김으로 세므로 5초 뒤)이 되면
 * 안내로 바꾼다 — 재시도는 세션이 계속하고, 붙으면 바로 본문이 나온다. 종단은 본문 위 자기 안내(띠)를 쓴다.
 * 첫 동기화 전의 상태는 connecting·offline·종단뿐이라 status 만으로 정해진다.
 */
export type BodyState = 'ready' | 'loading' | 'unreachable'

export function deriveBodyState(i: { everSynced: boolean; status: SyncStatus }): BodyState {
  if (i.everSynced) return 'ready'
  if (i.status === 'connecting') return 'loading'
  return i.status === 'offline' ? 'unreachable' : 'ready'
}

/** 편집 가능 역할인지 — 모르는 역할은 읽기 전용으로 본다(fail-closed). 동기화 서버와 같은 규약(collab-protocol). */
export function isEditRole(role: string): boolean {
  return isCollabEditRole(role)
}

/**
 * 서버 stateless 페이로드에서 역할 변경 알림({"type":"collab:role","role":...})의 역할을 꺼낸다.
 * 다른 메시지거나 형식이 틀리면 null — 모르는 메시지로 편집 권한을 바꾸지 않는다.
 */
export function parseRoleMessage(payload: string): string | null {
  try {
    const msg: unknown = JSON.parse(payload)
    if (typeof msg !== 'object' || msg === null) return null
    const { type, role } = msg as { type?: unknown; role?: unknown }
    return type === COLLAB_ROLE_CHANGED_TYPE && typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

/**
 * 에디터에 적용할 실제 읽기 전용 여부.
 * 서버가 최근에 알려 준 값(인증 scope 또는 역할 변경 알림)이 있으면 그것이 최종이다 — 세션 도중 VIEWER 로 강등되면
 * 화면의 역할 정보가 낡았어도 편집을 막고, EDITOR 로 승격되면 다시 연다. 서버 응답 전에는 화면이 아는 역할(prop)을 쓴다.
 * 종단 상태면 무조건 읽기 전용.
 */
export function effectiveReadOnly(i: {
  propReadOnly: boolean
  serverReadOnly: boolean | null
  terminal?: CollabTerminal | null
}): boolean {
  // 접근이 끊긴(삭제·권한 없음·로그인 상실·스키마 판 불일치) 문서는 어떤 역할이든 더 고칠 수 없다 — 고쳐도 서버로 보낼 수 없다.
  if (i.terminal) return true
  return i.serverReadOnly ?? i.propReadOnly
}

/**
 * 새로고침 — 'outdated'(스키마 판 불일치) 칩·안내의 동작. 새 에디터(새 스키마)를 받아야만 다시 붙을 수 있다.
 * 칩과 안내 띠가 같은 동작을 쓰도록 한곳에 둔다.
 */
export function reloadPage(): void {
  window.location.reload()
}
