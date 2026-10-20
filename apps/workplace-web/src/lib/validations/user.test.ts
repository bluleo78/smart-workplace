// 비밀번호 규칙·변경 스키마 단위 테스트(WP-412) — 이전 E2E settings/profile-password-complexity 의
// 「숫자 없음 에러」·「모두 포함하면 에러 없음」을 옮겼다. 규칙 위반이 UI 에러로 뜨고 서버 요청을 막는 배선은 대문자 케이스 E2E 가 지킨다.
import { describe, expect, it } from 'vitest'

import { changePasswordSchema, PASSWORD_BYTES_MESSAGE, passwordRule, updateProfileSchema } from './user'

const messages = (v: string) => (passwordRule.safeParse(v).error?.issues ?? []).map((i) => i.message)

describe('passwordRule (#794)', () => {
  it('대/소문자·숫자를 모두 포함한 8자 이상이면 통과', () => {
    expect(passwordRule.safeParse('NewPass123').success).toBe(true)
  })
  it('빠진 종류마다 한국어 안내', () => {
    expect(messages('newpass123')).toEqual(['대문자를 1자 이상 포함해야 합니다'])
    expect(messages('NEWPASS123')).toEqual(['소문자를 1자 이상 포함해야 합니다'])
    expect(messages('NewPassword')).toEqual(['숫자를 1자 이상 포함해야 합니다'])
  })
  it('길이 8~128자', () => {
    expect(messages('Ab1')).toContain('비밀번호는 8자 이상이어야 합니다')
    expect(messages(`Ab1${'x'.repeat(126)}`)).toContain('비밀번호는 128자 이하여야 합니다')
  })
  it('bcrypt 한도 72바이트 — 한글은 24자까지(WP-497)', () => {
    expect(passwordRule.safeParse(`Ab1${'x'.repeat(69)}`).success).toBe(true)
    expect(messages(`Ab1${'x'.repeat(70)}`)).toEqual([PASSWORD_BYTES_MESSAGE])
    expect(passwordRule.safeParse(`Ab1${'가'.repeat(23)}`).success).toBe(true)
    expect(messages(`Ab1${'가'.repeat(24)}`)).toEqual([PASSWORD_BYTES_MESSAGE])
  })
})

describe('updateProfileSchema — 이름 길이(WP-569)', () => {
  const nameMessages = (name: string) =>
    (updateProfileSchema.safeParse({ name, email: '' }).error?.issues ?? []).map((i) => i.message)
  it('DB 컬럼(50자)까지 받고, 51자부터 한국어로 막는다', () => {
    expect(updateProfileSchema.safeParse({ name: '가'.repeat(50), email: '' }).success).toBe(true)
    expect(nameMessages('가'.repeat(51))).toEqual(['이름은 50자까지 쓸 수 있습니다'])
  })
})

describe('changePasswordSchema', () => {
  it('새 비밀번호와 확인이 다르면 confirmPassword 에러', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'NewPass123', confirmPassword: 'NewPass124' })
    expect(r.error?.issues.map((i) => [i.path[0], i.message])).toEqual([['confirmPassword', '비밀번호가 일치하지 않습니다']])
  })
})
