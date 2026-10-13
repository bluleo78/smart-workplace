import { expect } from 'vitest'

/**
 * 동기화 서버 테스트의 대기 규칙(웹 E2E e2e/fixtures/wait.ts 와 같은 원칙).
 * - 시간이 아니라 상태를 기다린다 — 반드시 오는 상태(메시지 도착·저장·동기화·언로드·재접속)는 ARRIVAL 로 상태가 될 때까지 본다.
 * - 앱 타이머(표식·태그 만료, 병합 기한)가 원인이면 그 타이머를 손으로 돌리는 시계(manualClock)로 넘긴다 — 실제 시간을 기다리지 않는다.
 * - "아무 일도 없다"는 고정 관찰 창이 불가피하므로 expectStays 한 곳에 모은다.
 */

/**
 * 반드시 오는 상태를 기다리는 창의 상한 — 상태가 되면 바로 끝나므로 시간 단언이 아니라 멈춤 감시다(테스트 시간 제한 15초보다 짧게 둬
 * 멈췄을 때 무엇을 기다렸는지가 실패 메시지에 남는다). vitest 기본 1초는 부하에서 소켓 왕복이 1초를 넘을 때 "1초 안에 도착"이라는
 * 의도하지 않은 시간 단언이 됐다.
 */
export const ARRIVAL_LIMIT_MS = 10_000

/** expect.poll 둘째 인자 — `await expect.poll(() => api.stores.length, ARRIVAL).toBe(1)` */
export const ARRIVAL = { timeout: ARRIVAL_LIMIT_MS, interval: 10 }

/**
 * 부재 확인 — ms 동안 read() 가 expected 로 유지되는지 20ms 간격으로 지켜본다(중간에 잠깐 어긋나도 잡는다).
 * "더 저장하지 않는다 / ack 를 보내지 않는다"는 일정 시간 아무 일도 없음을 봐야 하므로 고정 창이 불가피하다 — 그 창을 이 한 곳에 모은다.
 * 부하로 서버가 늦으면 창 안에 일이 안 일어나 통과할 수 있다(거짓 통과 쪽) — 거짓 실패는 없다. 앱 타이머가 원인이면 먼저 시계로 넘긴다.
 * reach: true 면 expected 에 닿을 때까지(ARRIVAL) 기다린 뒤 창을 연다(첫 저장 1회 도착 뒤 더 없음 등).
 */
export async function expectStays<T>(
  read: () => T,
  expected: T,
  { ms = 300, reach = false }: { ms?: number; reach?: boolean } = {},
): Promise<void> {
  if (reach) await expect.poll(read, ARRIVAL).toEqual(expected)
  const deadline = Date.now() + ms
  for (;;) {
    expect(read()).toEqual(expected)
    const left = deadline - Date.now()
    if (left <= 0) return
    await new Promise((r) => setTimeout(r, Math.min(20, left)))
  }
}
