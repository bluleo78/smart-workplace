import { z } from 'zod';

export const updateProfileSchema = z.object({
  // 이름은 1자 이상 50자 이하 — DB 컬럼(user.name VARCHAR(50))·서버 검증과 일치(#26, WP-569: 100자로 어긋나 51~100자가 영어 오류로 샜다)
  name: z.string().min(1, '이름을 입력하세요').max(50, '이름은 50자까지 쓸 수 있습니다'),
  email: z.string().email('유효한 이메일을 입력하세요').optional().or(z.literal('')),
});

// bcrypt 가 받는 비밀번호 최대 길이(UTF-8 바이트) — 서버 BcryptLimitPasswordEncoder 와 같다(WP-497).
// 글자 수가 아니라 바이트라 한글(3바이트)은 24자까지다.
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_BYTES_MESSAGE = '비밀번호는 72바이트를 넘을 수 없습니다(영문 72자, 한글 24자까지)';

/** 비밀번호가 bcrypt 한도(72바이트) 안인지 — 공유 링크 비밀번호처럼 zod 폼이 아닌 입력도 같은 판정을 쓴다. */
export function isPasswordWithinBytes(value: string): boolean {
  return new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES;
}

// 공용 비밀번호 규칙 — 서버(@Pattern: 8~128자, 대/소문자·숫자 각 1자 이상 + bcrypt 72바이트)와 일치.
// 구성원 추가(AddMemberDialog)·비밀번호 설정(SetPasswordCard)·비밀번호 변경이 함께 쓴다(#794, WP-48).
export const passwordRule = z
  .string()
  .min(8, '비밀번호는 8자 이상이어야 합니다')
  .max(128, '비밀번호는 128자 이하여야 합니다')
  .regex(/[A-Z]/, '대문자를 1자 이상 포함해야 합니다')
  .regex(/[a-z]/, '소문자를 1자 이상 포함해야 합니다')
  .regex(/[0-9]/, '숫자를 1자 이상 포함해야 합니다')
  .refine(isPasswordWithinBytes, PASSWORD_BYTES_MESSAGE);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '현재 비밀번호를 입력하세요'),
  // 대/소문자·숫자 복잡도 검증 — 공용 passwordRule 사용.
  // 서버(@Pattern)와 검증 규칙을 일치시켜 클라이언트에서 먼저 차단, 서버의 영문 오류 메시지 노출을 방지 (#794)
  newPassword: passwordRule,
  confirmPassword: z.string().min(1, '비밀번호 확인을 입력하세요'),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: '비밀번호가 일치하지 않습니다',
  path: ['confirmPassword'],
});

export type UpdateProfileFormData = z.infer<typeof updateProfileSchema>;
export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
