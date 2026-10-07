/**
 * 노트 동시 편집의 웹 ↔ 동기화 서버(workplace-collab) 통신 규약 — 양쪽이 같은 값을 쓰도록 한곳에 둔다.
 * 한쪽만 바뀌면 런타임에서야 어긋나므로(예: 조각 이름이 다르면 문서가 통째로 중복) 각 앱에 복사하지 않는다.
 * 의존성 없는 모듈이라 웹은 subpath(`@smart-workplace/wiki-editor-schema/collab-protocol`)로 tiptap 없이 가져간다.
 */

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

/** 권한 회수(멤버 제거·페이지 삭제)로 끊는 WebSocket 종료 코드 — 웹은 종단(재연결 안 함)으로 본다. */
export const CLOSE_FORBIDDEN = { code: 4403, reason: 'forbidden' } as const

/** E2E 네임스페이스를 심는 localStorage 키 — 병렬 테스트끼리 문서가 섞이지 않게 문서 이름 앞에 붙인다. */
export const COLLAB_NS_STORAGE_KEY = 'e2e:collabNs'

/** 문서 이름 — 운영은 `wiki-page:{id}`, E2E 는 `{ns}/wiki-page:{id}`(ns 가 빈 문자열이면 접두 없음). */
export function collabDocName(ns: string, pageId: number): string {
  return `${ns ? `${ns}/` : ''}wiki-page:${pageId}`
}
