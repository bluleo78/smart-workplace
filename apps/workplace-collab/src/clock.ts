/**
 * 시각과 타이머를 함께 주는 시계 — 동기화 서버의 앱 타이머(병합 실행기 기한·apply-markdown 기한·적용 저장 상한·토큰 만료·AI 태그 만료·
 * ✦ 표식 만료)가 이것으로 시간을 잰다. 운영은 실제 시계(realClock)다.
 * 왜 바꿔 끼우나: 테스트가 실제 시계로 기한·만료를 재면 기계 부하(워커 기동·메시지 왕복이 수 초로 늘어남)에 따라 결과가 달라진다 —
 * 테스트는 손으로 돌리는 시계(testing/manualClock)로 "기한이 왔다·만료됐다"를 테스트가 정한 사건으로 만든다.
 * 실행기·태그판·표식판·서버가 함께 쓰므로 어느 한 모듈(예: 워커 실행기)에 두지 않는다 — 여기서는 아무것도 불러오지 않는다.
 */
export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  /** setTimeout 이 돌려준 손잡이만 받는다 — 다른 시계의 손잡이를 넘기면 엉뚱한 타이머를 지우거나 아무것도 지우지 못한다. */
  clearTimeout(handle: unknown): void
}

/** 실제 시계(Date.now·setTimeout) — 모든 시계 주입 지점의 기본값. */
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout | undefined),
}
