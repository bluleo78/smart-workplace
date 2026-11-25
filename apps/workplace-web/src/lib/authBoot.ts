/**
 * WP-2087: 문서 첫 로드의 「첫 refresh 끝남」 신호.
 *
 * 왜: 첫 주소 청크 미리 받기(App) 가 auth/refresh 보다 먼저 나가면, HTTP/1.1(호스트당 소켓 6개)에서는 이슈 상세의
 * 정적 그래프 183개 청크가 refresh 를 마지막 청크가 끝날 때까지 줄 세웠다(실측: 상세 요청이 FCP 뒤 803ms).
 * 그래서 미리 받기를 refresh 가 끝난 뒤(성공·실패 무관)로 미루는데, 그 신호를 AuthContext 와 App 이 모듈 상태로 주고받는다.
 * WP-2116: 신호에 「미리 받을지」도 싣는다 — 일시 오류·워크스페이스 선택 화면에서는 그 청크를 쓰지 않으므로 받지 않는다.
 */

/**
 * 첫 refresh 신호 상태 — pending(아직 안 옴)·go(미리 받기)·skip(미리 받지 않음, WP-2116).
 * 문서당 첫 신호만 효과다. 예외: skip 뒤의 go 는 되살린다(일시 오류 뒤 다시 시도 성공). skip 인 동안 대기자는 타이머 없이 go 만 기다린다.
 */
let state: 'pending' | 'go' | 'skip' = 'pending'
/** 신호를 기다리는 구독자 — true 신호가 오면 각자 자기 예약을 잡고 스스로 빠진다(순회 중 삭제는 Set 에서 안전하다). */
const waiters = new Set<() => void>()

/**
 * 첫 refresh 가 끝났음(성공·실패·로그인 흔적 없음 모두)을 알린다. 문서당 첫 호출만 효과가 있다.
 * preload=false 면 대기자·이후 예약은 안전망 시각에도 돌지 않는다(미리 받기 생략).
 * 다만 생략 뒤에 true 가 오면 되살린다 — 일시 오류로 「다시 시도」 화면이 떴다가 다시 시도로 앱에 들어간 경우다(WP-2116 리뷰).
 * 그 경우 미리 받기는 앱에 들어가는 그 refresh 뒤에 돈다. 그 밖의 뒤 신호(true 뒤 무엇이든, false 뒤 false)는 무시한다.
 */
export function markInitialRefreshSettled(preload = true): void {
  if (state === 'go' || (state === 'skip' && !preload)) return
  state = preload ? 'go' : 'skip'
  for (const onSignal of waiters) onSignal()
}

/**
 * 첫 refresh 가 끝난 뒤 cb 를 한 번만 부른다. 신호와 timeoutMs 중 먼저 오는 때 — 이미 끝났으면 바로 예약한다.
 * 신호로 부르는 경우 cb 는 항상 다음 매크로태스크(setTimeout 0)에서 돈다. 왜: 신호는 initAuth 의 동기 구간 한복판에서 오는데,
 * 같은 구간 몇 줄 뒤에 상세 미리 요청·users/me 가 나간다. cb(청크 183개 import)를 그 자리에서 돌리면 HTTP/1.1 에서 그 요청들이
 * 청크 뒤에 줄을 선다. 한 틱 미루면 그 요청들이 먼저 나가고, 첫 그리기를 먼저 하게 두던 예전 setTimeout(0) 지연도 유지된다.
 * timeoutMs 는 신호가 영영 안 오는 경로(예: AuthProvider 가 없는 화면)에서 미리 받기가 영영 안 나가는 것을 막는 안전망이다.
 * 돌려준 함수를 부르면 취소된다(대기 중인 타이머도 지운다 — 언마운트·StrictMode 재실행용).
 */
export function afterInitialRefresh(cb: () => void, timeoutMs = 3000): () => void {
  // 타이머는 하나만 쥔다 — 처음엔 안전망, 신호가 오면 그것을 지우고 다음 작업(0ms)으로 바꾼다. 취소·실행 모두 타이머를 지우거나
  // 소진하고 구독에서 빠지므로 cb 가 두 번 불리지 않는다.
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => {
    waiters.delete(onSignal)
    cb()
  }
  function onSignal() {
    clearTimeout(timer)
    // 미리 받기 생략 신호면 안전망 타이머만 지우고 구독은 남긴다 — 뒤에 true(다시 시도 성공)가 오면 그때 예약한다.
    if (state === 'skip') return
    waiters.delete(onSignal)
    timer = setTimeout(run, 0)
  }
  if (state === 'skip') {
    // 이미 생략 신호가 왔다 — 안전망 없이 다음 true 신호만 기다린다.
    waiters.add(onSignal)
  } else if (state === 'go') {
    timer = setTimeout(run, 0)
  } else {
    waiters.add(onSignal)
    timer = setTimeout(run, timeoutMs)
  }
  return () => {
    waiters.delete(onSignal)
    clearTimeout(timer)
  }
}

/** 테스트 전용 — 모듈 상태를 문서 첫 로드 직후로 되돌린다. */
export function resetAuthBootForTest(): void {
  state = 'pending'
  waiters.clear()
}
