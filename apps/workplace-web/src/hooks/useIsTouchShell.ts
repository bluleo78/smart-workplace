// 터치 셸(모바일 폭 + coarse 포인터) 여부를 구독하는 훅 — 회전·창 크기·포인터 변화에 즉시 재렌더한다.
// 판정 규칙은 lib/mobile/touchShell.ts 참조. 메시지 행마다 호출돼도 MediaQueryList·리스너는 스토어당 한 벌이다.
import { useSyncExternalStore } from 'react'

import { getIsTouchShell, subscribeTouchShell } from '@/lib/mobile/touchShell'

/** 모바일 터치 셸 여부. SSR/초기 스냅샷이 없는 환경에선 false(데스크톱 동작). */
export function useIsTouchShell(): boolean {
  return useSyncExternalStore(subscribeTouchShell, getIsTouchShell, () => false)
}
