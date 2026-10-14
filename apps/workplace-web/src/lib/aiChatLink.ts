// WP-384 AI 대화 링크 규칙 — 딥링크 `/?chat=<sessionId>`(지난 대화 검색 결과·출처 링크)와 AI 답 안 내부 링크 판별.

/** 딥링크 쿼리 이름. */
export const CHAT_PARAM = 'chat';

/** 없는(지움·남의) 대화 딥링크 토스트. */
export const CHAT_NOT_FOUND_MESSAGE = '대화를 찾을 수 없어요';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 대화 id 모양(UUID)인가 — 아니면 서버에 묻지 않고 "찾을 수 없음"으로 끝낸다. */
export function isSessionId(v: string | null | undefined): v is string {
  return !!v && UUID.test(v);
}

/** 같은 출처 상대 경로("/…")인가 — "//host"(프로토콜 상대)·"/\host"(브라우저가 // 로 읽는다)는 외부로 본다. */
export function isInternalHref(href: string | null | undefined): href is string {
  return !!href && href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\');
}

/** "/?chat=<uuid>" 딥링크면 그 id, 아니면 null — 지금 화면에 머문 채 대화만 여는 링크로 바꿀 때 쓴다. */
export function chatLinkSessionId(href: string | null | undefined): string | null {
  if (!isInternalHref(href)) return null;
  const url = new URL(href, 'http://local');
  if (url.pathname !== '/') return null;
  const id = url.searchParams.get(CHAT_PARAM);
  return isSessionId(id) ? id : null;
}
