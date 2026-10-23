// 하단 탭바를 7칸으로 넓힐 만한 폭인지 구독하는 훅 — 회전·창 크기 변경 즉시 반영(WP-877).
import { useSyncExternalStore } from 'react'

import { tabBarWideStore } from '@/lib/mobile/mediaQueryStore'

/** 넓은 폰(390pt 이상) 여부. 초기 스냅샷이 없는 환경에선 좁은 폰(false)으로 본다. */
export function useIsTabBarWide(): boolean {
  return useSyncExternalStore(tabBarWideStore.subscribe, tabBarWideStore.get, () => false)
}
