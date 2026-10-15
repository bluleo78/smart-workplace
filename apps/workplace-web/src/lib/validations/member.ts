// 구성원 추가 폼 스키마·요청 조립 — AddMemberDialog 의 순수 규칙(WP-412 에서 컴포넌트 밖으로 분리).
import { z } from 'zod'

import type { CreateMemberRequest } from '@/types/user'

import { passwordRule } from './user'

// 구성원 추가 폼 — 아이디(로그인 ID)/이메일(선택)/이름/역할 + 로그인 방식(WP-48).
// 아이디는 로그인 방식과 무관하게 회사 계정 주소(이메일)여야 한다(첫 SSO 로그인 매칭 키 — WP-181, 서버도 동일 검증).
// SSO 전용이면 비밀번호를 받지 않는다.
export const addMemberSchema = z
  .object({
    loginMethod: z.enum(['SSO', 'PASSWORD']),
    // trim 후 검사 — 공백만 입력한 값이 서버로 전송되는 것을 클라이언트에서 먼저 차단한다.
    username: z
      .string()
      .trim()
      .min(1, '아이디를 입력하세요')
      .max(50, '아이디는 50자 이하여야 합니다')
      .pipe(z.email('아이디는 이메일 형식이어야 합니다')),
    email: z.email('올바른 이메일 형식이 아닙니다').optional().or(z.literal('')),
    name: z.string().trim().min(1, '이름을 입력하세요').max(50, '이름은 50자 이하여야 합니다'),
    password: z.string().optional(),
    role: z.enum(['ADMIN', 'USER']),
  })
  .superRefine((v, ctx) => {
    if (v.loginMethod === 'SSO') return
    const r = passwordRule.safeParse(v.password ?? '')
    if (!r.success) ctx.addIssue({ code: 'custom', path: ['password'], message: r.error.issues[0].message })
  })

export type AddMemberFormData = z.infer<typeof addMemberSchema>

/**
 * 검증된 폼 값 → 구성원 생성 요청.
 * 이메일 빈 문자열은 전송에서 뺀다(백엔드 선택값). SSO 전용은 비밀번호를 보내지 않는다(WP-48) — 로그인 방식 자체도 서버 필드가 아니다.
 */
export function toCreateMemberPayload(data: AddMemberFormData): CreateMemberRequest {
  const { loginMethod, password, ...rest } = data
  return {
    ...rest,
    email: rest.email ? rest.email : undefined,
    ...(loginMethod === 'PASSWORD' ? { password } : {}),
  }
}
