// 실행 플랫폼 판정 — iOS 기기·홈 화면 앱(standalone). 푸시 지원 판정(lib/push/support)과 뷰어 저장 방식(WP-278)이 같이 쓴다.
// 판정(detectIOS)은 순수 함수로 두고 브라우저 값 읽기만 감싼다.

/** iOS(iPhone·iPod·iPad) 인가. iPadOS 는 데스크톱(Mac) UA 를 쓰므로 MacIntel + 터치 포인트로 보정한다. */
export function detectIOS(env: { userAgent: string; platform: string; maxTouchPoints: number }): boolean {
  return /iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1)
}

/** 현재 브라우저가 iOS 인가. */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return detectIOS({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints })
}

/** 홈 화면 앱(standalone)으로 실행 중인가 — 표준 display-mode + iOS 의 navigator.standalone. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iOS 홈 화면 앱(standalone)인가 — 뷰어 저장 방식(a[download] 가 불안정해 공유 시트로 대체, WP-278) 판정용. */
export function isIOSStandalone(): boolean {
  return isIOSDevice() && isStandaloneDisplay()
}
