import { describe, it, expect } from 'vitest'
import { badgeVariant, hasCardContent } from './IssueInstantContextCard'

// AiSignalVariant 실제 어휘: 'action' | 'info' (aiMarker.ts)
// BLOCKED/OVERDUE → 'action'(사용자 행동 필요), STALE → 'info'(정보성)
describe('badgeVariant', () => {
  it('BLOCKED→action, OVERDUE→action, STALE→info', () => {
    expect(badgeVariant('BLOCKED')).toBe('action')
    expect(badgeVariant('OVERDUE')).toBe('action')
    expect(badgeVariant('STALE')).toBe('info')
  })
})

describe('hasCardContent', () => {
  it('summary 있으면 true', () => {
    expect(hasCardContent({ summary: 'x', nextAction: null, generatedAt: null, blockers: [] })).toBe(true)
  })
  it('공백만인 summary는 false', () => {
    expect(hasCardContent({ summary: '   ', nextAction: null, generatedAt: null, blockers: [] })).toBe(false)
  })
  it('blocker 있으면 true', () => {
    expect(hasCardContent({ summary: null, nextAction: null, generatedAt: null, blockers: [{ type: 'OVERDUE', message: 'm' }] })).toBe(true)
  })
  it('둘 다 없으면 false', () => {
    expect(hasCardContent({ summary: null, nextAction: null, generatedAt: null, blockers: [] })).toBe(false)
    expect(hasCardContent(null)).toBe(false)
    expect(hasCardContent(undefined)).toBe(false)
  })
})
