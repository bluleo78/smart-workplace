// 가입 스키마 이름 길이 단위 테스트(WP-670) — 이름은 저장 한도(user.name VARCHAR(50))와 같은 50자까지.
// 예전엔 100자까지 받아 51자부터 서버가 거절했다.
import { describe, expect, it } from 'vitest'

import { signupSchema } from './auth'

const base = { username: 'jane@acme.com', password: 'Password123', confirmPassword: 'Password123', email: '' }
const nameError = (name: string) =>
  signupSchema.safeParse({ ...base, name }).error?.issues.find((i) => i.path[0] === 'name')?.message

describe('signupSchema — 이름 길이', () => {
  it('50자는 통과한다', () => {
    expect(nameError('가'.repeat(50))).toBeUndefined()
  })

  it('51자면 「이름은 50자 이하여야 합니다」', () => {
    expect(nameError('가'.repeat(51))).toBe('이름은 50자 이하여야 합니다')
  })
})
