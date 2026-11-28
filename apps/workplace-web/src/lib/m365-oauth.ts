import { useEffect, useRef } from 'react'

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

/** 같은 연결의 postMessage·BroadcastChannel 중복 수신으로 보는 간격(ms) */
const DUPLICATE_WINDOW_MS = 1000

/**
 * 팝업의 연결 결과를 받는다 — notifyOpener 의 수신 쪽.
 * - postMessage(동일 출처만)·BroadcastChannel 두 경로를 모두 듣는다.
 * - 한 번의 연결이 두 경로로 와도 콜백은 한 번만 부른다(짧은 간격 안의 같은 결과는 중복으로 본다).
 * - enabled 가 false 이면 듣지 않고, 바뀌거나 언마운트되면 정리한다.
 * onResult 는 최신 값을 ref 로 읽어 구독을 다시 하지 않는다.
 */
export function useM365OAuthResult(onResult: (result: M365OAuthResult) => void, enabled = true): void {
  const handlerRef = useRef(onResult)
  useEffect(() => {
    handlerRef.current = onResult
  })

  useEffect(() => {
    if (!enabled) return
    let lastAt = 0
    let lastOk: boolean | null = null
    const receive = (data: unknown) => {
      const d = data as M365OAuthResult | undefined
      if (d?.source !== M365_OAUTH_SOURCE) return
      const now = Date.now()
      // 중복 수신 방어 — 같은 결과가 짧은 간격 안에 다시 오면 무시
      if (lastOk === d.ok && now - lastAt < DUPLICATE_WINDOW_MS) return
      lastAt = now
      lastOk = d.ok
      handlerRef.current(d)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return // 출처 검증(보안)
      receive(e.data)
    }
    window.addEventListener('message', onMessage)
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(M365_OAUTH_CHANNEL)
      channel.onmessage = (e: MessageEvent) => receive(e.data)
    } catch {
      /* BroadcastChannel 미지원 환경 — postMessage 만으로 충분 */
    }
    return () => {
      window.removeEventListener('message', onMessage)
      channel?.close()
    }
  }, [enabled])
}
