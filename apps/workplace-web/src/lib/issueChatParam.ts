// 이슈 채팅 딥링크 쿼리(`?chat=1`) — 한 곳에 둔다(WP-1372).
// 팀 이슈는 이 값으로 채팅 드로워를 열고(useIssueChatDrawerParam), 개인 작업은 리다이렉트가 이 값을 이어 받아 데스크톱은 모달 위 채팅 서랍을 열고
// (useIssueChatDrawerParam, WP-1374) 모바일은 상세 안의 채팅으로 이동한다(usePersonalTaskChatJump).
// 알림(notifTarget)·「내 AI 작업」 링크(issueChatPath)·리다이렉트가 같은 이름·값을 쓰게 해 어긋나지 않게 한다.
import type { NavigateFunction } from 'react-router-dom'

import { stripHistoryKey, toSearch } from '@/lib/historyParam'

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

/** 이슈 채팅 딥링크를 지울 위치 — react-router 의 location 과 같은 모양(필요한 칸만). */
interface ChatLocation {
  pathname: string
  search: string
  hash: string
  state: unknown
}

/**
 * 주소에서 chat 만 지운다(replace) — 경로·다른 쿼리·hash·router state(task 열림 마크 등)는 그대로 두고, chat 의 열림 마크만 함께 뺀다.
 * replace 라 히스토리 항목 수와 idx 가 그대로여서, 아래 화면(상세) 닫기(뒤로)가 chat 상태로 돌아가지 않는다.
 * 개인 작업의 채팅 딥링크 소비(모바일 usePersonalTaskChatJump)·없는 작업의 chat 정리(데스크톱 useIssueChatDrawerParam 의 clearWhen)가 함께 쓴다.
 */
export function removeIssueChatParam(navigate: NavigateFunction, location: ChatLocation): void {
  const params = new URLSearchParams(location.search)
  params.delete(ISSUE_CHAT_PARAM)
  void navigate(
    { pathname: location.pathname, search: toSearch(params), hash: location.hash },
    { replace: true, state: stripHistoryKey(location.state, ISSUE_CHAT_PARAM) },
  )
}
