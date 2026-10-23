// src/lib/pwa/applyUpdate.ts
// 새 서비스워커 적용과 창 새로고침(WP-664).
// vite-plugin-pwa 는 SKIP_WAITING 뒤 "이 창을 관리하던 SW 가 바뀔 때(controlling·isUpdate)"만, 그것도 토스트를 띄운 창만 새로고침한다.
// 강제 새로고침한 창은 SW 관리 밖(controller 없음)이라 그 신호가 오지 않아 토스트를 눌러도 아무 일이 없었고,
// 토스트를 본 적 없는 창은 새 SW 아래에서 옛 번들로 남았다.
// → 누른 창은 대기 중인 SW 가 활성화되는 것을 직접 기다렸다가 새로고침하고(applyWaitingUpdate),
//   관리받던 다른 창은 관리 SW 가 바뀌면 알린다(watchControllerUpdate).
// 적용하는 길이 둘(토스트 PwaUpdatePrompt·404 복구 outdatedApp)이라, 이 창이 적용 중인지는 여기 한 곳에 둔다.

// 이 창이 지금 새 버전을 적용 중인지 — 그동안 이 창에도 오는 관리 SW 교체(controllerchange)는 적용하는 쪽이 새로고침하므로 넘긴다.
let applyingInThisWindow = false

/** 이 창이 applyWaitingUpdate 로 새 버전을 적용하는 중인지 */
export function isApplyingUpdate(): boolean {
  return applyingInThisWindow
}

/** 상태 전환을 지켜볼 수 있는 ServiceWorker(테스트 대역 포함) */
export type WaitingSw = EventTarget & { state: string }

/**
 * 대기 중인 SW 를 활성화하고, 활성화가 끝난 뒤 새로고침한다 — 새로고침한 문서가 새 SW 의 관리를 받게 하려는 것.
 * 대기 중인 SW 가 없으면(다른 창이 이미 적용) 바로 새로고침한다.
 * 활성화되지 않고 밀려나면(더 새 SW 에 밀려 redundant) 새로고침하지 않고 false 를 돌려준다 — 옛 SW 가 그대로면
 * 새로고침해도 옛 버전을 다시 받을 뿐이라, 호출부가 다시 시도할 수 있게 알린다.
 */
export async function applyWaitingUpdate(
  waiting: WaitingSw | null,
  skipWaiting: () => Promise<void> | void,
  reload: () => void,
): Promise<boolean> {
  if (!waiting) {
    reload()
    return true
  }
  applyingInThisWindow = true
  try {
    // 메시지보다 리스너를 먼저 건다 — 활성화가 빨라 statechange 를 놓치지 않게.
    const settled = waitForSwState(waiting, ['activated', 'redundant'])
    await skipWaiting()
    if ((await settled) !== 'activated') return false
    reload()
    return true
  } finally {
    // 끝나면 푼다 — 호출부가 새로고침을 건너뛴 창(404 화면을 떠남)이 다음 배포의 관리 SW 교체까지 놓치지 않게.
    applyingInThisWindow = false
  }
}

/**
 * SW 가 targets 중 한 상태가 될 때까지 기다려 그 상태를 돌려준다 — 이미 그 상태면 바로, timeoutMs 를 넘기면 null.
 * 부르는 즉시 리스너를 걸므로 상태를 바꾸는 요청(SKIP_WAITING 등)보다 먼저 부른다.
 */
export function waitForSwState(sw: WaitingSw, targets: readonly string[], timeoutMs?: number): Promise<string | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (state: string | null) => {
      clearTimeout(timer)
      sw.removeEventListener('statechange', onStateChange)
      resolve(state)
    }
    const onStateChange = () => {
      if (targets.includes(sw.state)) finish(sw.state)
    }
    sw.addEventListener('statechange', onStateChange)
    if (timeoutMs != null) timer = setTimeout(() => finish(null), timeoutMs)
    // 리스너를 걸기 전에 이미 그 상태였을 수 있다.
    onStateChange()
  })
}

/**
 * 이 창을 관리하던 SW 가 다른 SW 로 바뀌면(새 버전 활성화) onUpdate 를 부른다. 정리 함수를 돌려준다.
 * sw.ts 는 clients.claim() 을 하지 않아 관리 밖 창에는 controllerchange 가 오지 않지만, 나중에 claim 을 넣더라도
 * 첫 설치(관리 없음 → 관리)를 업데이트로 오인해 새로고침하지 않도록 방어로 걸러 둔다.
 */
export function watchControllerUpdate(
  container: EventTarget & { controller: unknown },
  onUpdate: () => void,
): () => void {
  let previous = container.controller
  const onChange = () => {
    const wasControlled = previous != null
    previous = container.controller
    if (wasControlled) onUpdate()
  }
  container.addEventListener('controllerchange', onChange)
  return () => container.removeEventListener('controllerchange', onChange)
}
