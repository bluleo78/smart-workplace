// 이슈 채팅 드로워 열림 상태를 URL(`?chat=1`)에 두는 훅(H2) — 공용 useHistoryParam 의 얇은 래퍼(WP-205).
// 왜: 모바일에서 드로워는 화면 전체를 덮는 "한 단계 깊은 화면"이라, 시스템 뒤로가기가 이슈 상세를 떠나지 않고
// 드로워만 닫아야 한다. 데스크톱도 같은 규칙 — 새로고침·링크 공유 시 드로워가 열린 채 복원된다.
// 경로(pathname)는 그대로라 #885 출발 화면 기록(useIssueOriginTracker)은 두 항목 모두 "이슈 상세"로 보고 함께 건너뛴다.
// 동작 차이(의도): 마크 없이 idx>0 에서 열린 ?chat=1(다른 화면 링크로 진입)은 예전엔 replace 로 닫았지만,
// 이제 시스템 back 과 같게 -1(출발 화면)으로 닫는다. 콜드 딥링크(idx 0)는 예전과 같이 chat 만 지운다.
import { useCallback } from 'react'

import { useHistoryParam } from '@/hooks/useHistoryParam'

export function useIssueChatDrawerParam(): { open: boolean; openChat: () => void; closeChat: () => void } {
  const { value, open, close } = useHistoryParam('chat')
  const openChat = useCallback(() => open('1'), [open])
  return { open: value === '1', openChat, closeChat: close }
}
