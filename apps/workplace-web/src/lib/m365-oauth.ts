// M365 OAuth 팝업 ↔ 메인 창 통신 단일 출처.
// 1차: window.opener.postMessage(targetOrigin 명시). 폴백: BroadcastChannel(COOP 로 opener 끊김 대비).
export const M365_OAUTH_CHANNEL = 'm365-oauth'
export const M365_OAUTH_SOURCE = 'm365-oauth'

/** 팝업 → 메인 창 통지 페이로드. source 로 무관한 message 이벤트와 구분. */
export type M365OAuthResult = {
  source: typeof M365_OAUTH_SOURCE
  ok: boolean
  error?: string
}

/**
 * 연결 결과를 메인 창에 통지한다(두 경로 동시 — 메인은 idempotent 수신).
 * - postMessage: opener 가 살아 있으면 즉시 전달. targetOrigin 은 동일 출처로 제한.
 * - BroadcastChannel: COOP 로 opener 가 끊긴 경우의 폴백.
 */
export function notifyOpener(result: M365OAuthResult): void {
  try {
    window.opener?.postMessage(result, window.location.origin)
  } catch {
    /* opener 접근 불가(COOP) — BroadcastChannel 폴백에 의존 */
  }
  try {
    const ch = new BroadcastChannel(M365_OAUTH_CHANNEL)
    ch.postMessage(result)
    ch.close()
  } catch {
    /* BroadcastChannel 미지원 환경 — 무해 */
  }
}
