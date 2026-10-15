/**
 * promise 를 최대 ms 만큼만 기다린다 — 그 안에 끝나면 결과를, 넘기면 undefined 로 이행한다.
 *
 * - "부드러운" 타임아웃이다: 시간 초과는 reject 가 아니라 undefined 로 끝난다(멈춘 부수 작업을 건너뛰고 다음 단계로
 *   넘어가려는 용도. 예: 로그아웃 전 푸시 구독 해제 요청이 네트워크 hang 으로 멈춰도 로그아웃은 진행 — AuthContext).
 * - 원래 promise 가 먼저 reject 하면 그 에러를 그대로 전파한다(호출측의 다음 단계가 실패 시엔 건너뛰어지도록 기존 동작 유지).
 * - 먼저 끝나면 타이머를 해제해 남은 타이머가 프로세스·테스트를 붙잡지 않게 한다.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
