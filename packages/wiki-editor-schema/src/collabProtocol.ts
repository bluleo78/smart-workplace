/**
 * 노트 동시 편집의 웹 ↔ 동기화 서버(workplace-collab) 통신 규약 — 양쪽이 같은 값을 쓰도록 한곳에 둔다.
 * 한쪽만 바뀌면 런타임에서야 어긋나므로(예: 조각 이름이 다르면 문서가 통째로 중복) 각 앱에 복사하지 않는다.
 * 의존성 없는 모듈이라 웹은 subpath(`@smart-workplace/wiki-editor-schema/collab-protocol`)로 tiptap 없이 가져간다.
 */

export { WIKI_SCHEMA_VERSION } from './schemaVersion'

/** 웹이 스키마 판을 실어 보내는 접속 URL 쿼리 이름 — `/collab?schema=1`. 서버는 onAuthenticate 의 requestParameters 로 읽는다. */
export const COLLAB_SCHEMA_PARAM = 'schema'

/**
 * 스키마 판이 없거나 다를 때의 인증 거부 사유(provider onAuthenticationFailed 의 reason).
 * 웹은 이것을 인증 실패와 구분해 재연결을 멈추고 새로고침을 안내한다.
 */
export const COLLAB_SCHEMA_MISMATCH = 'schema-mismatch'

/** TipTap Collaboration 의 Yjs 조각(field) 이름 — 웹 에디터와 서버 코덱이 같아야 한다. */
export const COLLAB_FRAGMENT = 'default'

/** 편집 가능한 역할 — 그 밖(VIEWER·알 수 없는 값)은 모두 읽기 전용으로 닫는다(fail-closed). */
export const COLLAB_EDIT_ROLES: ReadonlySet<string> = new Set(['OWNER', 'EDITOR'])

/** 역할이 편집 가능한가 — 서버의 readOnly 판정과 웹의 에디터 잠금이 같은 규칙을 쓴다. */
export function isCollabEditRole(role: string): boolean {
  return COLLAB_EDIT_ROLES.has(role)
}

/**
 * 세션 도중 역할 변경을 알리는 stateless 메시지 type — payload: {type, role}.
 * Hocuspocus 프로토콜엔 권한 범위 변경 메시지가 없어 웹이 에디터 편집 가능 여부를 이것으로 바꾼다.
 */
export const COLLAB_ROLE_CHANGED_TYPE = 'collab:role'

/** 토큰 만료로 끊는 WebSocket 종료 코드 — 웹은 토큰을 갱신하고 다시 붙는다. */
export const CLOSE_TOKEN_EXPIRED = { code: 4401, reason: 'token expired' } as const

/**
 * 권한 회수(멤버 제거 등)로 끊는 WebSocket 종료 코드 — 웹은 종단(재연결 안 함)으로 본다.
 * 서버가 삭제임을 확신하지 못한 경우(사유 없는 재검증에서 판정 404 — 비멤버와 없는 페이지가 같다)도 이 코드다.
 * 확실한 삭제는 CLOSE_DELETED(4404)로 따로 알린다.
 */
export const CLOSE_FORBIDDEN = { code: 4403, reason: 'forbidden' } as const

/**
 * 페이지 삭제로 끊는 WebSocket 종료 코드(WP-296) — 웹은 종단 'deleted'(재연결 안 함)로 보고 "이 노트가 삭제되었습니다"를 보인다.
 * 4403(권한 회수)과 나눈 이유: 서버 판정(collab-access)은 비멤버와 없는 페이지를 같은 404 로 돌려줘, 사유를 모르는 끊김은 둘을 가를 수 없다.
 * 그래서 확실히 삭제임을 아는 경우(API 의 삭제 재검증, 내부 저장 404)에만 이 코드를 쓴다. 접속·재접속 시 로드 404 는 인증 거부(forbidden)로 나간다.
 */
export const CLOSE_DELETED = { code: 4404, reason: 'deleted' } as const

/** revalidate 요청의 삭제 사유 — API 가 페이지 삭제(서브트리) 재검증에 싣는다. 접근을 잃은 연결은 CLOSE_DELETED 로 닫힌다. */
export const REVALIDATE_REASON_DELETED = 'deleted' as const

/** E2E 네임스페이스를 심는 localStorage 키 — 병렬 테스트끼리 문서가 섞이지 않게 문서 이름 앞에 붙인다. */
export const COLLAB_NS_STORAGE_KEY = 'e2e:collabNs'

/** 문서 이름 — 운영은 `wiki-page:{id}`, E2E 는 `{ns}/wiki-page:{id}`(ns 가 빈 문자열이면 접두 없음). */
export function collabDocName(ns: string, pageId: number): string {
  return `${ns ? `${ns}/` : ''}wiki-page:${pageId}`
}

/**
 * awareness 의 ✦ AI 표식 필드(WP-291, 스펙 §5.1-5·§5.2) — 값은 CollabAiMarker[] 또는 null.
 * 서버는 MCP·채팅 비서 적용 위치에 잠깐(COLLAB_AI_MARKER_MS), 웹은 `/ai` 생성 동안 삽입 위치에 고정해 올린다.
 * 둘이 같은 모양이라 그리는 쪽(웹)은 출처를 구분하지 않는다. 접속자 아바타 ✦ 배지(WP-173)도 이 필드로 판단한다.
 * 서버 상태는 이 필드만 있고 user·cursor 가 없다 — 접속자 목록·커서는 user 없는 상태를 건너뛰어야 한다.
 */
export const COLLAB_AI_MARKERS_FIELD = 'aiMarkers'

/** 서버가 AI 적용 위치에 ✦ 표식을 보이는 시간(ms) — 스펙 "~3초". */
export const COLLAB_AI_MARKER_MS = 3000

/**
 * ✦ 표식 하나 — name 은 AI 에게 시킨 사람(스펙 Q3, 빈 문자열이면 받는 쪽이 userId 로 이름을 찾는다).
 * anchor 는 Y.relativePositionToJSON 결과(받는 쪽이 자기 문서에서 위치로 푼다).
 */
export interface CollabAiMarker {
  id: string
  userId: number
  name: string
  anchor: unknown
}

/** awareness 값 → 표식 목록. 모양이 틀린 항목은 버린다(자기 신고 값이라 믿지 않음). */
export function parseAiMarkers(value: unknown): CollabAiMarker[] {
  if (!Array.isArray(value)) return []
  return value.filter((m): m is CollabAiMarker => {
    if (m == null || typeof m !== 'object') return false
    const o = m as Record<string, unknown>
    return (
      typeof o.id === 'string' &&
      typeof o.userId === 'number' &&
      typeof o.name === 'string' &&
      o.anchor != null &&
      typeof o.anchor === 'object'
    )
  })
}

/**
 * awareness 의 접속자 필드(WP-173) — 값 {id, name}. 웹이 노트에 붙어 있는 동안 올리고 재동기화(synced)마다 다시 올린다
 * (provider 가 pagehide·파기 때 내 상태를 지우므로). 색은 싣지 않는다 — 받는 쪽이 id 로 토큰 팔레트에서 정한다
 * (자기 신고 색을 믿지 않고, 같은 사람은 어디서나 같은 색). 서버 상태(aiMarkers 만)엔 이 필드가 없다.
 * 이름은 y-prosemirror 관례와 같다 — 스키마가 아니므로 WIKI_SCHEMA_VERSION 과 무관하다.
 */
export const COLLAB_USER_FIELD = 'user'

/**
 * awareness 의 커서 필드(WP-173) — 값 {anchor, head, seq?}(anchor·head 는 각각 Y.relativePositionToJSON) 또는 null.
 * seq 는 올린 사람의 "자기 편집·선택 활동" 횟수 — 문단 중간에서 타이핑하면 캐럿의 상대 위치(오른쪽 글자 기준)가 그대로라 받는 쪽이
 * 움직임을 알 수 없어서 둔다. 선택 사항이라 seq 없는 옛 클라이언트 값도 그대로 읽힌다(awareness 전용 — 스키마 판과 무관).
 * 편집 가능하고 에디터에 포커스가 있을 때만 올린다 — VIEWER·종단·포커스 없음이면 null(스펙 §7.1 ④ "내 커서는 비공개").
 */
export const COLLAB_CURSOR_FIELD = 'cursor'

/** 접속자 — 자기 신고 값(스펙 §4.1: 테넌트 내부 노출이라 위험 낮음, 수용). */
export interface CollabPresenceUser {
  id: number
  name: string
}

/** 원격 커서 — 받는 쪽이 자기 문서에서 위치로 푼다. */
export interface CollabCursor {
  anchor: object
  head: object
  /** 올린 사람의 자기 활동 횟수(편집·선택 변경) — 바뀌면 움직인 것이다. 없으면(옛 클라이언트) anchor·head 변화로만 판단. */
  seq?: number
}

/** awareness 값 → 접속자. id 가 유한한 숫자이고 name 이 문자열일 때만(그 밖의 키는 버린다). */
export function parseCollabUser(value: unknown): CollabPresenceUser | null {
  if (value == null || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'number' || !Number.isFinite(o.id) || typeof o.name !== 'string') return null
  return { id: o.id, name: o.name }
}

/** awareness 값 → 커서. anchor·head 둘 다 객체일 때만. seq 는 유한한 숫자일 때만 남긴다(깨진 seq 때문에 커서를 버리지 않는다). */
export function parseCollabCursor(value: unknown): CollabCursor | null {
  if (value == null || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (o.anchor == null || typeof o.anchor !== 'object' || o.head == null || typeof o.head !== 'object') return null
  const cursor: CollabCursor = { anchor: o.anchor, head: o.head }
  if (typeof o.seq === 'number' && Number.isFinite(o.seq)) cursor.seq = o.seq
  return cursor
}

/**
 * 에디터 안 AI 적용 직전 알림(WP-323) — 웹이 AI 결과를 문서에 넣기 직전에 보내는 stateless 메시지 type.
 * 동기화 서버는 미저장 사람 편집을 먼저 저장(사유 없음)하고, 이 문서에 AI 태그를 단 뒤 COLLAB_AI_APPLY_ACK_TYPE 으로 답한다.
 * 태그가 달린 뒤 처음 저장되는 판이 'AI' 사유 + 요청자(aiActorId)로 저장돼 API 가 AI 직전 판에 ✦ 리비전을 남긴다.
 */
export const COLLAB_AI_APPLY_TYPE = 'collab:ai-apply'

/** ai-apply 처리 완료 응답(서버 → 요청한 연결에만) — 웹은 이것(또는 시간 초과)을 기다린 뒤 삽입한다. */
export const COLLAB_AI_APPLY_ACK_TYPE = 'collab:ai-apply-ack'

/** AI 삽입 포기(중단·권한 회수 등) — 같은 사용자·같은 요청의 AI 태그를 지워 다음 사람 저장에 거짓 ✦ 가 붙지 않게 한다. */
export const COLLAB_AI_CANCEL_TYPE = 'collab:ai-cancel'

/** ai-apply·ai-apply-ack·ai-cancel 의 공통 페이로드 — requestId 로 요청과 응답·취소를 짝짓는다. */
export interface CollabAiApplyMessage {
  type: typeof COLLAB_AI_APPLY_TYPE | typeof COLLAB_AI_APPLY_ACK_TYPE | typeof COLLAB_AI_CANCEL_TYPE
  requestId: string
}

/** ai-apply·ai-cancel·ack 의 requestId 길이 상한 — 서버가 자기 신고 값을 그대로 되돌려 보내므로 긴 값은 받지 않는다. */
export const COLLAB_AI_REQUEST_ID_MAX = 128

/**
 * stateless 페이로드 → AI 적용 메시지(ai-apply·ack·cancel). JSON 이 아니거나 type 이 셋 중 하나가 아니거나
 * requestId 가 비었거나 너무 길면 null — 상대가 보낸 값이라 믿지 않는다. 서버·웹·E2E 가 같은 판정을 쓰게 한곳에 둔다
 * (어느 type 을 받을지는 쓰는 쪽이 고른다 — 서버는 ack 를 버리고, 웹은 ack 만 본다).
 */
export function parseCollabAiMessage(raw: string): CollabAiApplyMessage | null {
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (o == null || typeof o !== 'object') return null
  const { type, requestId } = o as Record<string, unknown>
  if (type !== COLLAB_AI_APPLY_TYPE && type !== COLLAB_AI_APPLY_ACK_TYPE && type !== COLLAB_AI_CANCEL_TYPE) return null
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > COLLAB_AI_REQUEST_ID_MAX) return null
  return { type, requestId }
}
