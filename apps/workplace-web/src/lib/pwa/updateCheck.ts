// src/lib/pwa/updateCheck.ts
// 열려 있는 앱에서도 새 배포를 감지하기 위한 서비스워커 업데이트 확인(WP-226).
// 브라우저는 페이지를 새로 열 때만 sw.js 를 다시 확인하고 SPA 내부 이동으로는 확인하지 않는다.
// 그래서 오래 열린 탭과 백그라운드에서 복귀한 홈 화면 PWA 는 새로고침 전까지 업데이트 토스트를 못 본다.
// → 주기적으로, 화면에 다시 보일 때, 보이는 상태에서 네트워크가 다시 연결될 때 registration.update() 를 불러 새 SW 설치를 유도한다.
//   설치된 새 SW 는 waiting 에 머물고, 적용은 기존처럼 사용자가 토스트를 눌러야 한다(PwaUpdatePrompt).

/** 탭을 열어 둔 채 쓰는 경우의 주기 확인 간격 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
/** 탭 전환을 자주 오가도 sw.js 요청이 몰리지 않게 하는 최소 간격 */
export const UPDATE_CHECK_COOLDOWN_MS = 60 * 1000

export interface UpdateCheckEnv {
  /** visibilitychange 를 발생시키는 문서(테스트에서 대역 주입) */
  doc: EventTarget & { visibilityState: DocumentVisibilityState }
  /** online 이벤트를 발생시키는 창 — 복귀 순간 네트워크가 아직 없던 경우 재연결 시 확인한다 */
  win: EventTarget
  isOnline: () => boolean
}

const browserEnv = (): UpdateCheckEnv => ({ doc: document, win: window, isOnline: () => navigator.onLine })

/** 업데이트 확인을 시작하고 정리 함수를 돌려준다. */
export function startSwUpdateChecks(
  registration: { update: () => Promise<unknown> },
  env: UpdateCheckEnv = browserEnv(),
): () => void {
  // 등록 직전 페이지 로드에서 브라우저가 이미 sw.js 를 확인했으므로 쿨다운을 지금부터 센다.
  let lastCheckedAt = Date.now()

  const check = () => {
    if (!env.isOnline()) return
    const now = Date.now()
    if (now - lastCheckedAt < UPDATE_CHECK_COOLDOWN_MS) return
    lastCheckedAt = now
    // 네트워크 오류 등으로 실패해도 다음 시점에 다시 확인하면 되므로 무시한다.
    registration.update().catch(() => {})
  }

  const checkIfVisible = () => {
    if (env.doc.visibilityState === 'visible') check()
  }

  // 숨겨진 탭은 확인해도 볼 사람이 없다 — 다시 보일 때 visibilitychange 가 확인한다.
  const timer = setInterval(checkIfVisible, UPDATE_CHECK_INTERVAL_MS)
  env.doc.addEventListener('visibilitychange', checkIfVisible)
  env.win.addEventListener('online', checkIfVisible)
  return () => {
    clearInterval(timer)
    env.doc.removeEventListener('visibilitychange', checkIfVisible)
    env.win.removeEventListener('online', checkIfVisible)
  }
}
