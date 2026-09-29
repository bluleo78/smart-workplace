// src/lib/push/subscription.ts
// 이 기기의 푸시 구독 수명주기. 브라우저 구독(PushManager)과 서버 매핑(/push/subscriptions)을 함께 관리한다.
// 로그아웃은 서버 매핑만 지운다(브라우저 구독 유지 → 다음 로그인 사용자가 재등록하면 소유자 이전).
import { pushApi } from '../../api/push'
import { sameApplicationServerKey, urlBase64ToBytes } from './keys'

/** 현재 기기 구독(서비스워커 미등록·미지원이면 null). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** 브라우저 구독 확보 — 키가 다르면(서버 재설치) 해지 후 새로 구독. */
async function ensureSubscription(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameApplicationServerKey(sub.options.applicationServerKey, vapidPublicKey)) {
    await sub.unsubscribe()
    sub = null
  }
  return (
    sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(vapidPublicKey) })
  )
}

/** 권한 요청 — 반드시 클릭 핸들러 안에서 동기적으로 호출한다(iOS 는 사용자 제스처 밖 요청을 거부). */
export function requestPushPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission()
}

/**
 * 푸시 켜기. permission 은 클릭 핸들러에서 이미 시작한 권한 요청 Promise — 여기서 요청하면 React Query 내부 await 뒤라 제스처가 끊긴다.
 * VAPID 키도 미리 로드된 config 에서 받는다.
 */
export async function enablePush(vapidPublicKey: string, permission: Promise<NotificationPermission>): Promise<void> {
  if ((await permission) !== 'granted') throw new Error('PERMISSION_DENIED')
  const sub = await ensureSubscription(vapidPublicKey)
  await pushApi.subscribe(sub.toJSON())
}

/** 푸시 끄기 — 서버 매핑 삭제 후 브라우저 구독 해지. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await pushApi.unsubscribe(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe()
}

/** 앱 진입(로그인·새로고침·테넌트 전환) 시 서버 매핑 재등록 — 권한과 구독이 이미 있을 때만. 실패는 조용히 무시. */
export async function syncPushOnLogin(): Promise<void> {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const existing = await currentSubscription()
    if (!existing) return
    const cfg = await pushApi.config()
    if (!cfg.enabled || !cfg.vapidPublicKey) return
    const sub = await ensureSubscription(cfg.vapidPublicKey)
    await pushApi.subscribe(sub.toJSON())
  } catch {
    // best-effort — 다음 진입 때 다시 시도
  }
}

/** 로그아웃 직전 — 이 기기의 서버 매핑만 삭제. */
export async function clearPushOnLogout(): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (sub) await pushApi.unsubscribe(sub.endpoint)
  } catch {
    // 로그아웃을 막지 않는다
  }
}
