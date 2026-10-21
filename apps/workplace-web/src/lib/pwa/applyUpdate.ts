// src/lib/pwa/applyUpdate.ts
// 새 서비스워커 적용과 창 새로고침(WP-664).
// vite-plugin-pwa 는 SKIP_WAITING 뒤 "이 창을 관리하던 SW 가 바뀔 때(controlling·isUpdate)"만, 그것도 토스트를 띄운 창만 새로고침한다.
// 강제 새로고침한 창은 SW 관리 밖(controller 없음)이라 그 신호가 오지 않아 토스트를 눌러도 아무 일이 없었고,
// 토스트를 본 적 없는 창은 새 SW 아래에서 옛 번들로 남았다.
// → 누른 창은 대기 중인 SW 가 활성화되는 것을 직접 기다렸다가 새로고침하고(applyWaitingUpdate),
//   관리받던 다른 창은 관리 SW 가 바뀌면 알린다(watchControllerUpdate).

type WaitingSw = EventTarget & { state: string }

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
  if (waiting) {
    // 메시지보다 리스너를 먼저 건다 — 활성화가 빨라 statechange 를 놓치지 않게.
    const activated = new Promise<boolean>((resolve) => {
      const onStateChange = () => {
        if (waiting.state !== 'activated' && waiting.state !== 'redundant') return
        waiting.removeEventListener('statechange', onStateChange)
        resolve(waiting.state === 'activated')
      }
      waiting.addEventListener('statechange', onStateChange)
    })
    await skipWaiting()
    if (!(await activated)) return false
  }
  reload()
  return true
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
