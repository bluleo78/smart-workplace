import { describe, expect, it } from 'vitest'

import { aiShortcutLabel, detectIOS, isAiToggleKey, isKKey } from './platform'

describe('detectIOS', () => {
  it('iPhone·iPad UA', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
  })
  it('iPadOS 데스크톱 UA 는 MacIntel + 터치 포인트로 보정', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })
  it('Android 는 아님', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false)
  })
})

// WP-1332 — AI 패널 단축키: macOS 는 ⌘K, Windows 등은 Alt+K 로 안내하고 받는다(Ctrl+K 도 계속 받는다).
describe('AI 패널 단축키', () => {
  const ev = (o: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
    key: 'k', code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o,
  })
  it('표기 — mac ⌘K, 그 밖 Alt+K', () => {
    expect(aiShortcutLabel(true)).toBe('⌘K')
    expect(aiShortcutLabel(false)).toBe('Alt+K')
  })
  it('Windows 는 Alt+K·Ctrl+K 를 받고, 한글 입력 상태(ㅏ)도 물리 키로 받는다', () => {
    expect(isAiToggleKey(ev({ altKey: true }), false)).toBe(true)
    expect(isAiToggleKey(ev({ key: 'ㅏ', altKey: true }), false)).toBe(true)
    expect(isAiToggleKey(ev({ ctrlKey: true }), false)).toBe(true)
  })
  it('mac 은 ⌘K 만 — ⌥K(특수문자 입력)는 가로채지 않는다', () => {
    expect(isAiToggleKey(ev({ metaKey: true }), true)).toBe(true)
    expect(isAiToggleKey(ev({ key: '˚', altKey: true }), true)).toBe(false)
  })
  it('예전 ⌘K·Ctrl+K 조합(Shift·Alt 함께)은 그대로 받는다', () => {
    expect(isAiToggleKey(ev({ metaKey: true, shiftKey: true }), true)).toBe(true)
    expect(isAiToggleKey(ev({ metaKey: true, altKey: true }), true)).toBe(true)
    expect(isAiToggleKey(ev({ ctrlKey: true, shiftKey: true }), false)).toBe(true)
  })
  it('수식키 없는 K·Alt+Shift·AltGr 문자 입력·다른 키·드보락의 K 자리는 아니다', () => {
    expect(isAiToggleKey(ev({}), false)).toBe(false)
    expect(isAiToggleKey(ev({ altKey: true, shiftKey: true }), false)).toBe(false)
    // AltGr+K 로 다른 글자(ĸ)를 치는 배열
    expect(isAiToggleKey(ev({ key: 'ĸ', altKey: true, ctrlKey: true }), false)).toBe(false)
    // 드보락: 물리 K 자리가 t — Alt+T 를 가로채지 않는다
    expect(isAiToggleKey(ev({ key: 't', altKey: true }), false)).toBe(false)
    expect(isAiToggleKey(ev({ key: 'j', code: 'KeyJ', altKey: true }), false)).toBe(false)
  })
  it('key 없는 keydown(자동 완성)에도 오류 없이 false', () => {
    expect(isAiToggleKey({ key: undefined, metaKey: false, ctrlKey: false, altKey: false }, false)).toBe(false)
    expect(isKKey({})).toBe(false)
  })
  it('isKKey — 한글 입력 상태는 물리 키로, 라틴 글자는 key 로 본다(노트 링크 넣기와 공통)', () => {
    expect(isKKey({ key: 'K', code: 'KeyK' })).toBe(true)
    expect(isKKey({ key: 'ㅏ', code: 'KeyK' })).toBe(true)
    expect(isKKey({ key: 't', code: 'KeyK' })).toBe(false)
  })
})
