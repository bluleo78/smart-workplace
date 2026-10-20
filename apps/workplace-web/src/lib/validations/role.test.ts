// 역할 폼 스키마 단위 테스트(WP-570) — 설명 상한이 서버·DB(255자)와 같은지.
import { describe, expect, it } from 'vitest'

import { createRoleSchema, updateRoleSchema } from './role'

describe('역할 설명 255자 상한 (WP-570)', () => {
  it('255자까지 받고 256자부터 한국어로 막는다 — 생성·수정 공통', () => {
    for (const schema of [createRoleSchema, updateRoleSchema]) {
      expect(schema.safeParse({ name: 'QA_ROLE', description: 'x'.repeat(255) }).success).toBe(true)
      const issues = schema.safeParse({ name: 'QA_ROLE', description: 'x'.repeat(256) }).error?.issues ?? []
      expect(issues.map((i) => i.message)).toEqual(['역할 설명은 255자까지 쓸 수 있습니다'])
    }
  })
})
