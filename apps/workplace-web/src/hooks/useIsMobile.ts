// 뷰포트가 모바일 폭(lg 미만)인지 구독하는 훅.
// useSyncExternalStore 로 matchMedia 변화를 구독해, 회전·창 크기 변경 시 셸이 즉시 전환되게 한다.
// MediaQueryList·리스너 공유 규칙은 lib/mobile/mediaQueryStore 참조.
import { useSyncExternalStore } from 'react'

import { mobileWidthStore } from '@/lib/mobile/mediaQueryStore'

/** 현재 뷰포트가 모바일 폭인지 동기적으로 읽는다 — 렌더 밖(이벤트 콜백 등)에서 즉시 판정할 때도 쓴다. */
export const getIsMobile = mobileWidthStore.get

/** 모바일 폭(lg 미만) 여부. SSR/초기 스냅샷이 없는 환경에선 데스크톱(false)으로 본다. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(mobileWidthStore.subscribe, mobileWidthStore.get, () => false)
}
