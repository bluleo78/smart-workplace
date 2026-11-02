// WP-1300 — HTML 블록 선택 안내 문구. 맥은 ⌘Enter, 그 밖은 Ctrl+Enter 로 표기한다(실제 키 Mod-Enter 와 같은 판정).
import { describe, expect, it } from 'vitest'

import { detectMacLike } from '@/lib/platform'

import { htmlEmbedKeyHint } from './wikiHtmlEmbedHint'

describe('htmlEmbedKeyHint', () => {
  it('맥 계열이면 ⌘Enter', () => {
    expect(htmlEmbedKeyHint(true)).toBe('Enter 다음 줄 · Esc 바깥으로 · ⌘Enter 바로 나가기')
  })

  it('그 밖(윈도·리눅스)이면 Ctrl+Enter', () => {
    expect(htmlEmbedKeyHint(false)).toBe('Enter 다음 줄 · Esc 바깥으로 · Ctrl+Enter 바로 나가기')
  })

  it('플랫폼 문자열 판정 — navigator.platform(편집기 Mod 키와 같은 기준) MacIntel 은 맥, Win32·Linux 는 아님', () => {
    expect(htmlEmbedKeyHint(detectMacLike('MacIntel'))).toContain('⌘Enter')
    expect(htmlEmbedKeyHint(detectMacLike('Win32'))).toContain('Ctrl+Enter')
    expect(htmlEmbedKeyHint(detectMacLike('Linux x86_64'))).toContain('Ctrl+Enter')
  })
})
