/**
 * 로그인 신원 바뀜 알림 (WP-1534).
 *
 * 왜 따로 두는가: 로그아웃·로그인은 메모리 토큰(setAccessToken)을 먼저 비우거나 바꾸고, React 의 user 상태는 그 뒤에야 다시 그려진다.
 * user id 를 보는 effect 로만 정리하면 그 틈에 이전 사용자의 요청(예: 드라이브 업로드 큐의 다음 파일)이 빈 토큰이나
 * 새 사용자의 토큰으로 나갈 수 있다. 그래서 AuthProvider 가 토큰을 건드리기 직전에 이 알림을 동기로 쏘고,
 * 사용자에게 묶인 작업(업로드 큐 등)이 그 자리에서 끊는다.
 */

type Listener = () => void

const listeners = new Set<Listener>()

/** 신원 바뀜을 구독한다 — 돌려준 함수로 끊는다. */
export function onIdentityChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 신원 바뀜을 알린다 — 구독자를 동기로 모두 부른다. 한 구독자의 오류가 나머지 정리나 로그아웃 자체를 막지 않게 삼킨다.
 * 로그아웃 시작·새 토큰 설치(로그인·SSO·워크스페이스 선택) 직전 어느 쪽이든 구독자는 같은 일을 하므로 까닭은 넘기지 않는다.
 * 반드시 토큰을 비우거나 바꾸기 전에 부른다.
 */
export function emitIdentityChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (e) {
      console.error('신원 바뀜 구독자 오류', e)
    }
  }
}
