// WP-384 AI 대화 링크 규칙 — 딥링크 `/?aiChat=<sessionId>`(지난 대화 검색 결과·출처 링크)와 AI 답 안 내부 링크 판별.
import type { HomeMessage, HomeSessionSummary } from '@/types/home';

/** 딥링크 쿼리 이름 — 이슈 채팅 드로워가 `chat` 을 쓰므로(useIssueChatDrawerParam) 겹치지 않는 이름. */
export const CHAT_PARAM = 'aiChat';

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

/** "/?aiChat=<uuid>" 딥링크면 그 id, 아니면 null — 지금 화면에 머문 채 대화만 여는 링크로 바꿀 때 쓴다. */
export function chatLinkSessionId(href: string | null | undefined): string | null {
  if (!isInternalHref(href)) return null;
  const url = new URL(href, 'http://local');
  if (url.pathname !== '/') return null;
  const id = url.searchParams.get(CHAT_PARAM);
  return isSessionId(id) ? id : null;
}

/** 지금 화면 쿼리에 aiChat 만 더한(같으면 바꾼) search — 다른 파라미터(이슈 드로워 등)는 그대로 둔다. */
export function withChatParam(search: string, id: string): string {
  const params = new URLSearchParams(search);
  params.set(CHAT_PARAM, id);
  return `?${params.toString()}`;
}

/** 서버 세션 제목 규칙(HomeSessionService.trimTitle) — 첫 사용자 메시지를 앞뒤 공백 없이 40자까지. */
const TITLE_MAX = 40;
/** 첫 질문이 없을 때(첨부만 보낸 대화 등) 헤더에 쓸 이름. */
export const LINKED_SESSION_FALLBACK_TITLE = '지난 대화';

/**
 * 링크·딥링크로 연 대화의 목록 항목(WP-384) — 세션 목록은 최근 30개만 받아 오래된 대화는 그 밖에 있다. 단건 조회 API 가 없으므로 복원한 이력으로
 * 서버와 같은 규칙의 제목을 만들어, 헤더·목록이 "대화 선택"으로 남지 않게 한다.
 */
export function linkedSessionSummary(id: string, messages: readonly HomeMessage[]): HomeSessionSummary {
  const first = messages.find((m) => m.role === 'USER' && m.content?.trim())?.content?.trim();
  return {
    id,
    title: first ? first.slice(0, TITLE_MAX) : LINKED_SESSION_FALLBACK_TITLE,
    lastMessageAt: messages.at(-1)?.createdAt ?? new Date(0).toISOString(),
    widgetCount: 0,
  };
}

/** 지금 대화가 목록에 없으면 링크로 연 항목을 끝에 붙인다(가장 오래된 쪽 — 목록은 최신순). 있으면 서버 목록 그대로. */
export function withLinkedSession(items: HomeSessionSummary[], linked: HomeSessionSummary | undefined): HomeSessionSummary[] {
  if (!linked || items.some((s) => s.id === linked.id)) return items;
  return [...items, linked];
}
