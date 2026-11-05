// 이슈 채팅 드로워 열림 상태를 URL(`?chat=1`)에 두는 훅(H2) — 공용 useHistoryParam 의 얇은 래퍼(WP-205).
// 왜: 모바일 드로워는 화면을 덮는 깊은 화면이라 시스템 뒤로가기가 이슈 상세가 아닌 드로워만 닫아야 한다.
// 닫기 규칙은 useHistoryParam 과 같다(링크로 진입 → 출발 화면으로 -1, 콜드 딥링크 → chat 만 지움).
// 개인 작업 넓은 모달(WP-1374)도 같은 훅을 쓰되 두 가지를 더한다:
// - unmarkedClose='replace' — 서랍이 모달 위에 겹치므로, 링크·알림·주소로 들어와 처음부터 열린 서랍(·낡거나 어긋난 마크)을 닫을 때
//   출발 화면으로 되돌아가(-1) 모달까지 닫지 않고 주소에서 chat 만 지운다(task·필터·router state 보존). 채팅 버튼으로 연 서랍은 그대로 연 시점 직전으로.
// - clearWhen — 작업 조회 실패(404 등)처럼 서랍을 열 대상이 없을 때 chat 을 지운다. 남겨 두면 같은 화면에서 다음에 여는 작업
//   (task 만 바꾸고 다른 쿼리는 둔다)에 chat=1 이 묻어가 엉뚱하게 서랍이 열린다.
// 닫기 중복 방지(‹ 연타·ESC+onOpenChange)와 낡은 콜백 무시는 공용 훅이 맡는다.
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useHistoryParam } from '@/hooks/useHistoryParam'
import type { HistoryParamOptions } from '@/lib/historyParam'
import { ISSUE_CHAT_OPEN, ISSUE_CHAT_PARAM, removeIssueChatParam } from '@/lib/issueChatParam'

interface Options {
  /** 마크 없는 닫기 규칙 — 'replace' 면 -1 대신 chat 만 지운다(개인 작업 모달 위 서랍). 기본은 공용 훅 규칙. */
  unmarkedClose?: HistoryParamOptions['unmarkedClose']
  /** 참이면 열린 chat 을 주소에서 지운다(서랍을 열 대상이 없음). */
  clearWhen?: boolean
}

export function useIssueChatDrawerParam({ unmarkedClose, clearWhen = false }: Options = {}): {
  open: boolean
  openChat: () => void
  closeChat: () => void
} {
  // unmarkedClose 는 원시값이라 렌더마다 새 옵션 객체여도 공용 훅의 콜백이 다시 만들어지지 않는다.
  const { value, open: openParam, close } = useHistoryParam(ISSUE_CHAT_PARAM, { unmarkedClose })
  const location = useLocation()
  const navigate = useNavigate()
  const open = value === ISSUE_CHAT_OPEN
  const openChat = useCallback(() => openParam(ISSUE_CHAT_OPEN), [openParam])

  useEffect(() => {
    if (clearWhen && open) removeIssueChatParam(navigate, location)
  }, [clearWhen, open, navigate, location])

  return { open, openChat, closeChat: close }
}
