import { COLLAB_ROLE_CHANGED_TYPE, isCollabEditRole } from '@smart-workplace/wiki-editor-schema/collab-protocol'

/**
 * 노트 동시 편집의 헤더 동기화 상태 판정 — 전부 순수 함수라 화면 없이 vitest 로 검증한다.
 * 세션(collabSession)이 모은 연결 사실을 받아 칩 하나로 줄이는 것까지만 하고, 표시 문구는 화면(Task 8)이 정한다.
 */

/**
 * 헤더 동기화 상태 — 정상은 'live'(점 하나), 문제 있을 때만 글자 칩.
 * 'forbidden' 은 페이지가 삭제됐거나 접근 권한이 사라진 종단 상태다(서버가 둘을 구분해 주지 않는다).
 * 'signed-out' 은 로그인이 풀려(refresh 거절) 다시 로그인하기 전엔 붙을 수 없는 종단 상태다.
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
  | 'signed-out'

// 잠깐 끊김(재연결 중)과 오프라인을 가르는 기준 — 짧은 네트워크 흔들림에 '오프라인'을 띄우지 않는다.
export const OFFLINE_AFTER_MS = 5000

/**
 * 상태 판정. 우선순위: signed-out·forbidden(종단) → 첫 동기화 전이면 connecting(5초 넘으면 offline) → readonly → 연결됨이면 live → 미전송 있으면 unsent
 * → 끊긴 지 5초 미만 reconnecting → 그 외 offline.
 * 연결된 동안의 미전송(서버 확인 대기 중인 방금 입력)은 정상 흐름이라 live 로 본다.
 */
export function deriveSyncStatus(i: {
  connected: boolean
  disconnectedForMs: number
  unsynced: boolean
  readOnly: boolean
  forbidden?: boolean
  /** 로그인 상실(refresh 거절) 종단. */
  authLost?: boolean
  /** 이 세션이 한 번이라도 동기화를 마쳤는지. 생략하면 마친 것으로 본다. */
  everSynced?: boolean
}): SyncStatus {
  // 로그인 상실이 먼저 — 다시 로그인하면 풀리는 상태라 사용자가 할 일을 알려야 한다.
  if (i.authLost) return 'signed-out'
  if (i.forbidden) return 'forbidden'
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
 * 안내로 바꾼다 — 재시도는 세션이 계속하고, 붙으면 바로 본문이 나온다. 종단(forbidden)은 본문 위 자기 안내를 쓴다.
 */
export type BodyState = 'ready' | 'loading' | 'unreachable'

export function deriveBodyState(i: { everSynced: boolean; forbidden: boolean; status: SyncStatus }): BodyState {
  if (i.everSynced || i.forbidden) return 'ready'
  return i.status === 'offline' ? 'unreachable' : 'loading'
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
 * 종단(forbidden) 상태면 무조건 읽기 전용.
 */
export function effectiveReadOnly(i: {
  propReadOnly: boolean
  serverReadOnly: boolean | null
  forbidden?: boolean
  authLost?: boolean
}): boolean {
  // 접근이 끊긴(삭제·권한 없음·로그인 상실) 문서는 어떤 역할이든 더 고칠 수 없다 — 고쳐도 서버로 보낼 수 없다.
  if (i.forbidden || i.authLost) return true
  return i.serverReadOnly ?? i.propReadOnly
}
