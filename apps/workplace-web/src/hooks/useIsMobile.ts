// 뷰포트가 모바일 폭(lg 미만)인지 구독하는 훅.
// useSyncExternalStore 로 matchMedia 변화를 구독해, 회전·창 크기 변경 시 셸이 즉시 전환되게 한다.
import { useSyncExternalStore } from 'react'

import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

const getSnapshot = () => window.matchMedia(MOBILE_MEDIA_QUERY).matches

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
