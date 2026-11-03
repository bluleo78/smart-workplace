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

/**
 * AI 패널 토글 단축키 표기(WP-1332) — macOS 계열은 ⌘K, 그 밖(Windows 등)은 Alt+K.
 * Windows 에서 Ctrl+K 는 브라우저 주소창 검색·노트 링크 넣기(WP-312)와 겹쳐 Alt+K 를 안내한다(Ctrl+K 도 계속 동작한다).
 */
export function aiShortcutLabel(mac: boolean = isMacLike()): string {
  return mac ? '⌘K' : 'Alt+K'
}

/** AI 토글 판정에 필요한 키 이벤트 값 — KeyboardEvent 의 부분집합이라 테스트에서 객체로 넣어 본다. */
export interface ShortcutKeyEvent {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey?: boolean
}

/**
 * AI 패널 토글 키인가(WP-1332). ⌘K·Ctrl+K 는 그대로 받고, macOS 가 아니면 Alt+K 도 받는다.
 * K 는 물리 키(code)로도 본다 — 한글 입력 상태에서는 key 가 'ㅏ' 로 와서 key 만으로는 놓친다.
 * macOS 의 ⌥K 는 특수문자(˚) 입력이라 가로채지 않는다.
 */
export function isAiToggleKey(e: ShortcutKeyEvent, mac: boolean = isMacLike()): boolean {
  const isK = e.key.toLowerCase() === 'k' || e.code === 'KeyK'
  if (!isK || e.shiftKey) return false
  if ((e.metaKey || e.ctrlKey) && !e.altKey) return true
  return !mac && e.altKey && !e.metaKey && !e.ctrlKey
}
