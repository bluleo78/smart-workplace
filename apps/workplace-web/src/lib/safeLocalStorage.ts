// 안전한 localStorage 접근 — 사생활 보호 모드·보안 정책으로 window.localStorage 접근 자체가 던지거나 window 가 없으면 null.
// 저장소를 주입받는 모듈(AI 채팅 스트림·빈 대화 추천 저장)의 기본 접근자로 같이 쓴다. 읽고 쓰는 호출 자체의 예외는 호출자가 잡는다.

/** window.localStorage 또는 null(접근 불가). 호출할 때마다 다시 본다. */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
