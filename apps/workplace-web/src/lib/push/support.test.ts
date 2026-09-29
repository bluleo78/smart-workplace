// src/lib/push/support.test.ts
// resolvePushSupport 순수 함수 테스트 — 브라우저 전역이 필요한 readPushEnv 는 여기서 검증하지 않는다.
import { describe, expect, it } from 'vitest'

import { type PushEnv, resolvePushSupport } from './support'

const base: PushEnv = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
  isIOS: false,
  isStandalone: false,
}

describe('resolvePushSupport', () => {
  it('권한 상태를 그대로', () => {
    expect(resolvePushSupport(base)).toBe('default')
    expect(resolvePushSupport({ ...base, permission: 'granted' })).toBe('granted')
    expect(resolvePushSupport({ ...base, permission: 'denied' })).toBe('denied')
  })
  it('iOS 는 홈 화면 설치 전이면 설치 안내', () => {
    expect(resolvePushSupport({ ...base, isIOS: true, hasPushManager: false, hasNotification: false })).toBe(
      'ios-needs-install',
    )
    expect(resolvePushSupport({ ...base, isIOS: true, isStandalone: true })).toBe('default')
  })
  it('API 가 없으면 unsupported', () => {
    expect(resolvePushSupport({ ...base, hasPushManager: false })).toBe('unsupported')
    expect(resolvePushSupport({ ...base, hasServiceWorker: false })).toBe('unsupported')
  })
})
