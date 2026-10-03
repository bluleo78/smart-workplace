// 이슈 채팅 드로워 열림 상태를 URL(`?chat=1`)에 두는 훅(H2) — 공용 useHistoryParam 의 얇은 래퍼(WP-205).
// 왜: 모바일 드로워는 화면을 덮는 깊은 화면이라 시스템 뒤로가기가 이슈 상세가 아닌 드로워만 닫아야 한다.
// 닫기 규칙은 useHistoryParam 과 같다(링크로 진입 → 출발 화면으로 -1, 콜드 딥링크 → chat 만 지움).
import { useCallback } from 'react'

import { useHistoryParam } from '@/hooks/useHistoryParam'

export function useIssueChatDrawerParam(): { open: boolean; openChat: () => void; closeChat: () => void } {
  const { value, open, close } = useHistoryParam('chat')
  const openChat = useCallback(() => open('1'), [open])
  return { open: value === '1', openChat, closeChat: close }
}
