// src/components/layout/inboxFocus.ts
// 알림 목록의 포커스 이동 도우미 — 버튼이 비활성화되는 동작(모두 읽음) 뒤 포커스가 BODY 로 떨어지지 않게 한다(WP-1845).

/** 알림 목록 스크롤 영역(tabpanel)의 testid — 포커스 대상 탐색과 영역 속성에 같이 쓴다. */
export const INBOX_SCROLL_TESTID = 'inbox-scroll-area'

/**
 * 목록 스크롤 영역에 포커스를 둔다. 영역이 없으면 아무것도 하지 않는다.
 * 옮길 곳이 없을 때(모두 읽음 뒤 버튼이 비활성)의 안전한 도착지다.
 * 문서에서 찾는 까닭: 모바일 머리의 「모두 읽음」(MarkAllReadButton)은 InboxList 트리 밖이라 영역 ref 를 받을 수 없다.
 * 영역은 tabpanel 이라 늘 tabIndex(불러오는 중이면 0, 그 밖에는 -1 — WP-1843)를 가지므로 임시 tabindex 없이 바로 focus() 한다
 * — 여기서 tabindex 를 달고 떼면 패널의 Tab 정지점 규칙을 덮어쓴다.
 */
export function focusInboxList(): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${INBOX_SCROLL_TESTID}"]`)
  el?.focus({ preventScroll: true })
}
