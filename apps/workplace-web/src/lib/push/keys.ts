// src/lib/push/keys.ts
// VAPID 공개키(base64url) ↔ 바이트 변환과 비교 — 서버 키가 바뀐 기기를 감지해 재구독하기 위해 쓴다.

/**
 * 패딩 없는 base64url → 바이트.
 * TS 5.7+ 는 TypedArray 가 백킹 버퍼 타입까지 제네릭이라 반환 타입을 명시하지 않으면
 * `Uint8Array<ArrayBufferLike>`(SharedArrayBuffer 포함)로 추론돼 `PushManager.subscribe` 등
 * `BufferSource`(ArrayBuffer 전용) 를 받는 DOM API 에 그대로 못 넘긴다 — 명시로 좁힌다.
 */
export function urlBase64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 현재 구독의 applicationServerKey 가 서버 키와 같은지. */
export function sameApplicationServerKey(
  current: ArrayBuffer | Uint8Array | null | undefined,
  vapidB64: string,
): boolean {
  if (!current) return false
  const a = current instanceof Uint8Array ? current : new Uint8Array(current)
  const b = urlBase64ToBytes(vapidB64)
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
