/**
 * 진행 중인 요청이 비기를 기다린다(WP-1967).
 *
 * 왜: 테스트 파일이 끝나면 DOM 환경이 내려가는데, MSW 핸들러가 delay 뒤에 늦게 응답하면
 * 그 응답이 내려간 환경에서 터져(ProgressEvent 미정의) 처리 안 된 오류로 게이트를 깼다.
 * 파일 끝(afterAll)에서 아직 끝나지 않은 요청이 없어질 때까지 잠시 기다려 이를 막는다.
 *
 * @param pending 진행 중인 요청 모음(size 만 본다 — Set·Map 모두)
 * @param opts timeoutMs 상한, intervalMs 확인 간격, setTimeout 주입(가짜 타이머에 영향받지 않게 진짜 것을 넘긴다)
 * @returns 비었으면 true, 상한(timeoutMs/intervalMs 회 확인)을 넘기면 false
 * @throws intervalMs 가 0 이하면 — 확인 횟수가 무한이 되어 멈추지 않는다
 */
export async function waitForPendingRequests(
  pending: { readonly size: number },
  opts: { timeoutMs: number; intervalMs: number; setTimeout: (fn: () => void, ms: number) => unknown },
): Promise<boolean> {
  if (!(opts.intervalMs > 0)) throw new Error(`intervalMs 는 0 보다 커야 한다: ${opts.intervalMs}`)
  // 시계(Date.now)가 아니라 확인 횟수로 센다 — 가짜 타이머가 켜진 채 끝난 파일에서도 멈추지 않게.
  const maxChecks = Math.ceil(opts.timeoutMs / opts.intervalMs)
  for (let i = 0; i < maxChecks && pending.size > 0; i++) {
    await new Promise<void>((resolve) => opts.setTimeout(resolve, opts.intervalMs))
  }
  return pending.size === 0
}

/** 요청이 끝난(request:end) 뒤 XHR 이벤트 전달이 끝날 만큼 기다리는 시간(ms). */
export const RESPONSE_DELIVERY_MS = 20

/**
 * 서버를 닫기 전에 더 기다릴 시간을 정한다(WP-1967 리뷰 후속).
 *
 * 왜: request:end 는 XHR 쪽이 응답 이벤트(readystatechange·progress·load)를 내기 전에 난다. 마지막 요청이 막 끝났으면
 * 아직 이벤트를 전달하는 중일 수 있어, 틱 하나만 기다리고 서버를 닫으면 늦은 이벤트가 내려간 DOM 환경에서 터진다.
 * afterAll 에서 기다린 요청도 끝나는 순간 lastEndedAt 이 새로 적히므로(확인 간격 10ms < 전달 시간) 이 한 조건으로 함께 덮는다.
 * 마지막 종료가 전달 시간 안이면 전달 시간만큼, 아니면 0(틱 하나) — 파일마다 붙는 시간을 늘리지 않게.
 *
 * @param lastEndedAt 마지막 요청 종료 시각(ms, 없으면 0 이하)
 * @param now 지금 시각(ms — lastEndedAt 과 같은 시계)
 */
export function settleDelayMs(lastEndedAt: number, now: number): number {
  return lastEndedAt > 0 && now - lastEndedAt < RESPONSE_DELIVERY_MS ? RESPONSE_DELIVERY_MS : 0
}

/**
 * 상한을 넘겨 남은 요청을 경고 한 줄로 만든다(WP-1967 리뷰 후속) — 다음 실패 때 어느 요청이 끝나지 않았는지 찾게.
 *
 * @param pending 진행 중인 요청(식별자 → 「METHOD URL」)
 * @param timeoutMs 기다린 상한(ms)
 */
export function describePendingRequests(pending: ReadonlyMap<string, string>, timeoutMs: number): string {
  return `파일 끝에서 ${timeoutMs}ms 를 기다려도 끝나지 않은 MSW 요청 ${pending.size}개: ${[...pending.values()].join(', ')}`
}
