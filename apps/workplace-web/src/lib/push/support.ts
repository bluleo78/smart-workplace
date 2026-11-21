// src/lib/push/support.ts
// 이 기기의 푸시 지원 상태 판별. 판단(resolvePushSupport)은 순수 함수로 두고 브라우저 값 수집(readPushEnv)만 분리해 테스트한다.

import { isIOSDevice, isStandaloneDisplay } from '../platform'

/**
 * 알림 권한이 차단됐을 때의 안내 문장 — 설정 > 알림과 인박스 배너(WP-1933)가 같은 문장을 쓰도록 한 곳에 둔다.
 * 문구를 바꾸면 매뉴얼 18장(문제 해결)의 같은 문장도 함께 고친다.
 */
export const PUSH_DENIED_GUIDE =
  '알림 권한이 차단되어 있습니다. 브라우저 주소창의 사이트 설정(또는 OS 설정 > 알림)에서 이 사이트의 알림을 허용해 주세요.'

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

/** 현재 브라우저 값 수집 — iOS·standalone 판정은 lib/platform. */
export function readPushEnv(): PushEnv {
  const hasNotification = 'Notification' in window
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : 'unavailable',
    isIOS: isIOSDevice(),
    isStandalone: isStandaloneDisplay(),
  }
}

export function getPushSupport(): PushSupport {
  return resolvePushSupport(readPushEnv())
}
