// 구성원 추가 스키마·요청 조립 단위 테스트(WP-412) — 이전 E2E admin/member-add(공백 아이디·이메일 없이 추가)·
// admin/member-add-sso(SSO 전용은 이메일 형식 아이디만)를 대체한다. 규칙 위반이 UI 에러로 뜨고 전송을 막는 배선은
// member-add 의 「이메일이 아닌 아이디」 E2E 가 지킨다.
import { describe, expect, it } from 'vitest'

import { type AddMemberFormData, addMemberSchema, toCreateMemberPayload } from './member'

const base = { loginMethod: 'PASSWORD', username: 'jane@acme.com', email: '', name: '김제인', password: 'Password123', role: 'USER' } as const
const firstError = (v: object, field: string) =>
  addMemberSchema.safeParse(v).error?.issues.find((i) => i.path[0] === field)?.message

describe('addMemberSchema', () => {
  it('아이디 공백만 입력하면 trim 후 「아이디를 입력하세요」', () => {
    expect(firstError({ ...base, username: '  ' }, 'username')).toBe('아이디를 입력하세요')
  })
  it('비밀번호·SSO 전용 모두 아이디는 이메일 형식이어야 한다(WP-181)', () => {
    expect(firstError({ ...base, username: 'max.lee' }, 'username')).toBe('아이디는 이메일 형식이어야 합니다')
    expect(firstError({ ...base, loginMethod: 'SSO', password: undefined, username: 'hong' }, 'username')).toBe(
      '아이디는 이메일 형식이어야 합니다',
    )
  })
  it('SSO 전용은 비밀번호 없이 통과, 비밀번호 방식은 복잡도 규칙을 따른다', () => {
    expect(addMemberSchema.safeParse({ ...base, loginMethod: 'SSO', password: undefined }).success).toBe(true)
    expect(firstError({ ...base, password: 'password' }, 'password')).toBe('대문자를 1자 이상 포함해야 합니다')
  })
})

describe('toCreateMemberPayload', () => {
  const parsed = (v: object) => addMemberSchema.parse(v) as AddMemberFormData

  it('이메일 빈값은 보내지 않는다(undefined)', () => {
    expect(toCreateMemberPayload(parsed(base))).toEqual({
      username: 'jane@acme.com', email: undefined, name: '김제인', role: 'USER', password: 'Password123',
    })
  })
  it('SSO 전용은 비밀번호·로그인 방식 없이 보낸다', () => {
    const body = toCreateMemberPayload(parsed({ ...base, loginMethod: 'SSO', username: 'hong@acme.com', name: '홍', password: undefined }))
    expect(JSON.parse(JSON.stringify(body))).toEqual({ username: 'hong@acme.com', name: '홍', role: 'USER' })
  })
})
