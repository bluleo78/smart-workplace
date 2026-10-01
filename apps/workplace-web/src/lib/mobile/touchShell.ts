// 모바일 터치 셸 판정 — 좁은 화면(lg 미만)이면서 주 포인터가 손가락(coarse)인 환경.
// 왜 두 조건을 함께 보나: 메시지 길게 누르기 시트·Enter 줄바꿈 같은 터치 전용 동작은 모바일 셸(<1024px)의 것이다.
// 넓은 화면의 터치 기기(태블릿 가로·터치 노트북)는 데스크톱 셸이라 기존 탭 툴바·Enter 전송(#884)을 그대로 쓴다.
// 좁은 창의 마우스 사용자(fine)는 hover 툴바가 그대로 동작해야 하므로 폭만으로도 판정하지 않는다.
import { MOBILE_MEDIA_QUERY } from './breakpoint'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

// 메시지 행마다 판정하므로 MediaQueryList 는 한 번만 만들어 재사용한다(최초 사용 시 지연 생성).
let mqls: [MediaQueryList, MediaQueryList] | null = null

/** [모바일 폭, coarse 포인터] MediaQueryList 쌍. matchMedia 가 없는 환경(node 테스트)에선 null. */
export function touchShellQueries(): [MediaQueryList, MediaQueryList] | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  mqls ??= [window.matchMedia(MOBILE_MEDIA_QUERY), window.matchMedia(COARSE_POINTER_QUERY)]
  return mqls
}

/** 지금 터치 셸인지 동기적으로 읽는다 — 키 입력 시점 판정(Enter 처리)처럼 렌더 밖에서도 쓴다. */
export function getIsTouchShell(): boolean {
  const q = touchShellQueries()
  return !!q && q[0].matches && q[1].matches
}
