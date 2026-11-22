/**
 * 진행 중인 요청이 비기를 기다린다(WP-1967).
 *
 * 왜: 테스트 파일이 끝나면 DOM 환경이 내려가는데, MSW 핸들러가 delay 뒤에 늦게 응답하면
 * 그 응답이 내려간 환경에서 터져(ProgressEvent 미정의) 처리 안 된 오류로 게이트를 깼다.
 * 파일 끝(afterAll)에서 아직 끝나지 않은 요청이 없어질 때까지 잠시 기다려 이를 막는다.
 *
 * @param pending 진행 중인 요청 식별자 집합(size 만 본다)
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
