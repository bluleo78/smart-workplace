// 프로젝트 폼 검증 스키마 — 백엔드 ProjectRequest 제약과 일치시킨다.

import { z } from 'zod';

// 프로젝트 키: 대문자/숫자 2~10자, 첫 글자는 대문자
export const projectKeySchema = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, {
  message: '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다',
});

export const createProjectSchema = z.object({
  key: projectKeySchema,
  name: z.string().min(1, '이름은 필수입니다').max(120),
  description: z.string().max(2000).optional(),
});
export type CreateProjectFormData = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type UpdateProjectFormData = z.infer<typeof updateProjectSchema>;
