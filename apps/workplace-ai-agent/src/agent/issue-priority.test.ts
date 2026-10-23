// normalizePriority 유닛 테스트 — 공백·대소문자 정규화와 MID 폴백.
import { describe, it, expect } from 'vitest'
import { normalizePriority } from './issue-priority.js'

describe('normalizePriority', () => {
  it('5단계는 그대로 둔다', () => {
    for (const p of ['HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST']) expect(normalizePriority(p)).toBe(p)
  })
  it('앞뒤 공백·소문자를 정리한다', () => {
    expect(normalizePriority(' HIGHEST')).toBe('HIGHEST')
    expect(normalizePriority(' lowest \n')).toBe('LOWEST')
    expect(normalizePriority('High')).toBe('HIGH')
  })
  it('모르는 값·문자열 아님·누락은 MID', () => {
    expect(normalizePriority('URGENT')).toBe('MID')
    expect(normalizePriority('')).toBe('MID')
    expect(normalizePriority(null)).toBe('MID')
    expect(normalizePriority(undefined)).toBe('MID')
    expect(normalizePriority(3)).toBe('MID')
  })
})
