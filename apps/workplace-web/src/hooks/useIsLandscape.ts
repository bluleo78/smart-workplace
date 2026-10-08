// 화면이 가로 방향인지 구독하는 훅 — 회전 즉시 반영(WP-278 모바일 뷰어의 바 기본 숨김).
import { useSyncExternalStore } from 'react'

import { landscapeStore } from '@/lib/mobile/mediaQueryStore'

/** 가로 방향 여부. 초기 스냅샷이 없는 환경에선 세로(false)로 본다. */
export function useIsLandscape(): boolean {
  return useSyncExternalStore(landscapeStore.subscribe, landscapeStore.get, () => false)
}
