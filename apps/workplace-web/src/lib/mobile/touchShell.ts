// 모바일 터치 셸 판정 — 좁은 화면(lg 미만)이면서 주 포인터가 손가락(coarse)인 환경.
// 왜 두 조건을 함께 보나: 메시지 길게 누르기 시트·Enter 줄바꿈 같은 터치 전용 동작은 모바일 셸(<1024px)의 것이다.
// 넓은 화면의 터치 기기(태블릿 가로·터치 노트북)는 데스크톱 셸이라 기존 탭 툴바·Enter 전송(#884)을 그대로 쓴다.
// 좁은 창의 마우스 사용자(fine)는 hover 툴바가 그대로 동작해야 하므로 폭만으로도 판정하지 않는다.
// 쓰임 구분: 레이아웃·크롬은 useIsMobile(폭), 입력 동작·입력 안내 문구는 이 판정(터치 셸)을 쓴다.
import { coarsePointerStore, mobileWidthStore } from './mediaQueryStore'

/** 지금 터치 셸인지 동기적으로 읽는다 — 키 입력 시점 판정(Enter 처리)처럼 렌더 밖에서도 쓴다. */
export const getIsTouchShell = (): boolean => mobileWidthStore.get() && coarsePointerStore.get()

/** 두 조건 중 하나라도 바뀌면 onChange — useSyncExternalStore 구독용. */
export function subscribeTouchShell(onChange: () => void): () => void {
  const offWidth = mobileWidthStore.subscribe(onChange)
  const offPointer = coarsePointerStore.subscribe(onChange)
  return () => {
    offWidth()
    offPointer()
  }
}
