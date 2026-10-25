// 2차 사이드바를 아이콘 줄로 접을 좁은 창(1280px 미만)인지 구독하는 훅 — 창 크기 변경 즉시 반영(WP-506).
import { useSyncExternalStore } from 'react'

import { sidebarCompactStore } from '@/lib/mobile/mediaQueryStore'

/** 1280px 미만 여부. 모바일 폭에서도 true 이므로 데스크톱 분기 안에서만 쓴다. 초기 스냅샷이 없는 환경에선 넓은 창(false)으로 본다. */
export function useIsSidebarCompact(): boolean {
  return useSyncExternalStore(sidebarCompactStore.subscribe, sidebarCompactStore.get, () => false)
}
