// 뷰포트가 모바일 폭(lg 미만)인지 구독하는 훅.
// useSyncExternalStore 로 matchMedia 변화를 구독해, 회전·창 크기 변경 시 셸이 즉시 전환되게 한다.
import { useSyncExternalStore } from 'react'

import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'

/** matchMedia 변경 이벤트를 구독한다 — 뷰포트가 lg 경계를 넘을 때 재렌더를 유발. */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** 현재 뷰포트가 모바일 폭인지 동기적으로 읽는다. */
const getSnapshot = () => window.matchMedia(MOBILE_MEDIA_QUERY).matches

/** 모바일 폭(lg 미만) 여부. SSR/초기 스냅샷이 없는 환경에선 데스크톱(false)으로 본다. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
