// 이슈/댓글 폼 검증 스키마 — 백엔드 IssueRequest 제약과 일치.

import { z } from 'zod';

const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']);
const priorityEnum = z.enum(['LOW', 'MID', 'HIGH']);

export const createIssueSchema = z.object({
  title: z.string().min(1, '제목은 필수입니다').max(200),
  body: z.string().max(10000).optional(),
  priority: priorityEnum.optional(),
  // YYYY-MM-DD 형식 (HTML date input) 또는 빈 문자열 허용
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  // Phase 3c — 생성 시 다중 담당자 지정용. 현재 dialog 에서는 미노출이지만 schema 는 허용.
  assigneeIds: z.array(z.number().int().positive()).optional().nullable(),
  // 이슈 유형 id — 생략 시 백엔드가 TASK 로 fallback.
  typeId: z.number().int().positive().optional().nullable(),
});
export type CreateIssueFormData = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10000).optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  dueDate: z.string().optional(),
  clearDueDate: z.boolean().optional(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1, '내용은 필수입니다').max(10000),
});
export type CreateCommentFormData = z.infer<typeof createCommentSchema>;
