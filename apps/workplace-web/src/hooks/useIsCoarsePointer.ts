// 주 포인터가 손가락(coarse)인지 구독하는 훅 — 폭과 무관(≥1024px 터치 태블릿 포함).
// 쓰임: hover 로만 드러나던 행 액션을 터치 기기에서 ⋯ 메뉴/액션 시트로 바꿀 때(WP-237). CSS 로 충분하면 `pointer-coarse:` 변형을 쓴다.
// 폭까지 함께 봐야 하는 입력 동작(Enter 처리 등)은 useIsTouchShell 을 쓴다.
import { useSyncExternalStore } from 'react'

import { coarsePointerStore } from '@/lib/mobile/mediaQueryStore'

/** coarse 포인터 여부. SSR/초기 스냅샷이 없는 환경에선 false(데스크톱 동작). */
export function useIsCoarsePointer(): boolean {
  return useSyncExternalStore(coarsePointerStore.subscribe, coarsePointerStore.get, () => false)
}
