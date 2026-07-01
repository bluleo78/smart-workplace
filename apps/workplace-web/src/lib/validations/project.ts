// 프로젝트 폼 검증 스키마 — 백엔드 ProjectRequest 제약과 일치시킨다.

import { z } from 'zod';

// 프로젝트 키: 대문자/숫자 2~10자, 첫 글자는 대문자
export const projectKeySchema = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, {
  message: '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다',
});

// TEAM·OPEN 은 key 필수(위 정규식), PERSONAL 은 key 생략(서버 자동 생성).
export const createProjectSchema = z
  .object({
    type: z.enum(['TEAM', 'PERSONAL', 'OPEN']).default('TEAM'),
    key: z.string().optional(),
    name: z.string().min(1, '이름은 필수입니다').max(120, '이름은 120자 이하여야 합니다'),
    description: z.string().max(2000, '설명은 2000자 이하여야 합니다').optional(),
  })
  .superRefine((val, ctx) => {
    // TEAM·OPEN 은 key 정규식 검증 (projectKeySchema 재사용으로 규칙 단일화). PERSONAL 의 key 는 submit 시 제거됨.
    if ((val.type === 'TEAM' || val.type === 'OPEN') && !projectKeySchema.safeParse(val.key).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['key'],
        message: '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다',
      });
    }
  });
// 입력 타입(폼 상태): default 적용 전이라 type 이 optional. useForm 의 입력 제네릭에 사용.
export type CreateProjectFormInput = z.input<typeof createProjectSchema>;
// 출력 타입(검증 후): default 적용되어 type 필수. submit 핸들러/payload 에 사용.
export type CreateProjectFormData = z.output<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1, '이름은 필수입니다').max(120, '이름은 120자 이하여야 합니다'),
  description: z.string().max(2000, '설명은 2000자 이하여야 합니다').optional(),
});
export type UpdateProjectFormData = z.infer<typeof updateProjectSchema>;
