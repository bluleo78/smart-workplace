// src/lib/push/support.ts
// 이 기기의 푸시 지원 상태 판별. 판단(resolvePushSupport)은 순수 함수로 두고 브라우저 값 수집(readPushEnv)만 분리해 테스트한다.

export type PushSupport = 'unsupported' | 'ios-needs-install' | 'denied' | 'default' | 'granted'

export interface PushEnv {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: NotificationPermission | 'unavailable'
  isIOS: boolean
  isStandalone: boolean
}

/** iOS 는 홈 화면 설치(standalone) 전에는 Push API 자체가 없으므로 설치 안내를 우선한다. */
export function resolvePushSupport(env: PushEnv): PushSupport {
  if (env.isIOS && !env.isStandalone) return 'ios-needs-install'
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported'
  if (env.permission === 'unavailable') return 'unsupported'
  return env.permission
}

/** 현재 브라우저 값 수집. iPadOS 는 데스크톱 UA 를 쓰므로 터치 포인트로 보정한다. */
export function readPushEnv(): PushEnv {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const hasNotification = 'Notification' in window
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : 'unavailable',
    isIOS,
    isStandalone,
  }
}

export function getPushSupport(): PushSupport {
  return resolvePushSupport(readPushEnv())
}
