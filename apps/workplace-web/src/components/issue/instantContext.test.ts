import { describe, expect,it } from 'vitest'

import { badgeVariant } from './instantContext'

// AiSignalVariant 실제 어휘: 'action' | 'info' (aiMarker.ts)
// BLOCKED/OVERDUE → 'action'(사용자 행동 필요), STALE → 'info'(정보성)
// hasCardContent 는 온디맨드 재설계(Task 6)로 제거됨 — 카드가 항상 렌더하므로 "내용 있냐" 게이트 불필요.
// 렌더 동작(생성 버튼 노출 여부 등)은 issue-instant-context.spec.ts(E2E)가 검증.
describe('badgeVariant', () => {
  it('BLOCKED→action, OVERDUE→action, STALE→info', () => {
    expect(badgeVariant('BLOCKED')).toBe('action')
    expect(badgeVariant('OVERDUE')).toBe('action')
    expect(badgeVariant('STALE')).toBe('info')
  })
})
