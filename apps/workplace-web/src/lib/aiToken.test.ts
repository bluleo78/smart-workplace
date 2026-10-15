// hasAiToken(WP-412) — AGENT 뱃지 중복("My AI AI") 방지 판정 단위 테스트(inbox·홈 알림 E2E 에서 이관).
import { describe, expect, it } from 'vitest'

import { hasAiToken } from './aiToken'

describe('hasAiToken (#636, #637)', () => {
  it('이름에 단어 "AI" 가 있으면 true(대소문자 무시)', () => {
    expect(hasAiToken('My AI')).toBe(true)
    expect(hasAiToken('ai 비서')).toBe(true)
    expect(hasAiToken('AI')).toBe(true)
  })

  it('단어 경계가 아니거나 없으면 false — 뱃지를 붙인다', () => {
    expect(hasAiToken('업무 비서')).toBe(false)
    expect(hasAiToken('MAIL bot')).toBe(false)
    expect(hasAiToken('Aiden')).toBe(false)
    expect(hasAiToken(null)).toBe(false)
    expect(hasAiToken(undefined)).toBe(false)
    expect(hasAiToken('')).toBe(false)
  })
})
