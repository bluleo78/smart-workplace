// SSO 공용 유틸 단위 테스트(WP-412) — 이전 E2E auth/login-sso(오류 코드별 배너 문구·모르는 코드 무시)·
// auth/sso-complete(외부 returnTo → 루트)를 대체한다. 배너가 화면에 뜨는 배선은 login-sso 의 denied 케이스가 지킨다.
import { describe, expect, it } from 'vitest'

import { safeReturnTo, ssoErrorMessage, ssoStartHref } from './sso'

describe('ssoErrorMessage', () => {
  it('알려진 코드는 배너 문구로', () => {
    expect(ssoErrorMessage('denied')).toBe('등록되지 않은 Microsoft 계정입니다. 관리자에게 등록을 요청하세요.')
    expect(ssoErrorMessage('consent')).toBe('조직 관리자의 앱 승인이 필요합니다.')
    expect(ssoErrorMessage('retry')).toBe('로그인 처리 중 문제가 발생했습니다. 다시 시도해 주세요.')
  })
  it('모르는 코드(unavailable 포함)·코드 없음은 null — 배너를 띄우지 않는다', () => {
    expect(ssoErrorMessage('unavailable')).toBeNull()
    expect(ssoErrorMessage(null)).toBeNull()
  })
})

describe('safeReturnTo', () => {
  it('same-origin 상대경로는 그대로', () => {
    expect(safeReturnTo('/settings/profile')).toBe('/settings/profile')
  })
  it('외부(//host)·역슬래시·제어문자·인코딩 우회·비상대경로는 루트로', () => {
    expect(safeReturnTo('//evil.com')).toBe('/')
    expect(safeReturnTo('/%2F%2Fevil.com')).toBe('/') // 디코드하면 ///evil.com
    expect(safeReturnTo('%2F%2Fevil.com')).toBe('/')
    expect(safeReturnTo('/\\evil.com')).toBe('/')
    expect(safeReturnTo('/a%0Ab')).toBe('/')
    expect(safeReturnTo('https://evil.com')).toBe('/')
    expect(safeReturnTo('%E0%A4%A')).toBe('/')
    expect(safeReturnTo(null)).toBe('/')
  })
})

describe('ssoStartHref', () => {
  it('returnTo 를 인코딩해 start 경로에 싣는다', () => {
    expect(ssoStartHref('/a?b=1')).toBe('/api/v1/auth/sso/start?returnTo=%2Fa%3Fb%3D1')
  })
})
