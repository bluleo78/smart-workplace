// 월 보기가 마지막으로 잰 행 높이(16px 기준 환산)의 기억 — 컴포넌트 모듈이 컴포넌트 외 값을 내보내지 않게 lib 에 둔다.
import { registerTestReset } from '@/lib/testResets'

// 월 보기는 전환마다 새로 마운트된다. 전과 같은 창이면 높이가 같으므로 첫 렌더부터 이 값을 써 전환 때 두 번 그리지 않는다(WP-1917).
let lastMonthRowHeight = 0

/** 기억한 행 높이 — 아직 잰 적이 없으면 0. */
export function getRememberedMonthRowHeight(): number {
  return lastMonthRowHeight
}

/** 방금 잰 행 높이를 기억한다. */
export function rememberMonthRowHeight(h: number): void {
  lastMonthRowHeight = h
}

/** 테스트·E2E 용 — 기억한 행 높이를 지운다. */
export function resetMonthRowHeightForTest(): void {
  lastMonthRowHeight = 0
}

// 테스트가 끝날 때마다 비워 앞 테스트의 높이가 다음 테스트 첫 렌더에 새지 않게 한다(공용 정리, src/test/setup.ts).
registerTestReset(resetMonthRowHeightForTest)
