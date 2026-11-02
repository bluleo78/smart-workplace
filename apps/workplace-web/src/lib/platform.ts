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

/** macOS·iOS 계열인가 — 단축키 표기(⌘ 대 Ctrl)를 고른다. 판정은 순수 함수로 두어 테스트에서 플랫폼 문자열을 넣어 본다. */
export function detectMacLike(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform)
}

/** 현재 브라우저가 macOS·iOS 계열인가. */
export function isMacLike(): boolean {
  return typeof navigator !== 'undefined' && detectMacLike(navigator.platform)
}

/** 단축키 표기 글자 — macOS 계열은 ⌘·⇧·⌥, 그 밖은 Ctrl+·Shift+·Alt+. 서식 툴바(노트·채팅)의 title 이 같은 표기를 쓰게 한곳에 둔다. */
export interface ShortcutKeys {
  mod: string
  shift: string
  alt: string
}

/** 이 브라우저(또는 mac 인자)의 단축키 표기 글자. */
export function shortcutKeys(mac: boolean = isMacLike()): ShortcutKeys {
  return mac ? { mod: '⌘', shift: '⇧', alt: '⌥' } : { mod: 'Ctrl+', shift: 'Shift+', alt: 'Alt+' }
}
