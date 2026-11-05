// 이슈 채팅 딥링크 쿼리(`?chat=1`) — 한 곳에 둔다(WP-1372).
// 팀 이슈는 이 값으로 채팅 드로워를 열고(useIssueChatDrawerParam), 개인 작업은 리다이렉트가 이 값을 이어 받아 상세 안의 채팅으로 이동한다.
// 알림(notifTarget)·「내 AI 작업」 링크(issueChatPath)·리다이렉트가 같은 이름·값을 쓰게 해 어긋나지 않게 한다.

/** 쿼리 이름. */
export const ISSUE_CHAT_PARAM = 'chat'
/** 열림 값. */
export const ISSUE_CHAT_OPEN = '1'

/** 쿼리 문자열(location.search)이 이슈 채팅 딥링크인가. */
export function hasIssueChatParam(search: string): boolean {
  return new URLSearchParams(search).get(ISSUE_CHAT_PARAM) === ISSUE_CHAT_OPEN
}

/** 이슈 채팅 딥링크 쿼리 문자열(`chat=1`, 앞의 `?` 없음) — 경로에 붙일 때 쓴다(issueChatPath). */
export const ISSUE_CHAT_QUERY = `${ISSUE_CHAT_PARAM}=${ISSUE_CHAT_OPEN}`
