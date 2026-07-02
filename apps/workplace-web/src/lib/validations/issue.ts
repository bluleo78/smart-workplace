// 이슈/댓글 폼 검증 스키마 — 백엔드 IssueRequest 제약과 일치.

import { z } from 'zod';

const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']);
const priorityEnum = z.enum(['LOW', 'MID', 'HIGH']);

export const createIssueSchema = z.object({
  // 공백만 있는 제목을 서버 왕복 없이 클라이언트에서 즉시 막기 위해 trim 후 검증 (#612).
  title: z.string().trim().min(1, '제목은 필수입니다').max(200, '제목은 200자 이하여야 합니다'),
  body: z.string().max(10000, '본문은 10000자 이하여야 합니다').optional(),
  priority: priorityEnum.optional(),
  // YYYY-MM-DD 형식 (HTML date input) 또는 빈 문자열 허용
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  // Phase 3c — 생성 시 다중 담당자 지정용. 현재 dialog 에서는 미노출이지만 schema 는 허용.
  assigneeIds: z.array(z.number().int().positive()).optional().nullable(),
  // 이슈 유형 id — 생략 시 백엔드가 TASK 로 fallback.
  typeId: z.number().int().positive().optional().nullable(),
  // SUBTASK 일 때만 의미가 있는 부모 number (Phase 4a).
  // SUBTASK 가 아닌 유형에 동봉하면 백엔드 400 — 다이얼로그에서 송신 시점에 제거.
  // error: valueAsNumber 빈 값 → NaN 변환 시 한국어 오류 표시 (#159). Zod v4 에서는 invalid_type_error 대신 error.
  parentNumber: z
    .number({ error: '부모 이슈 번호를 입력해주세요' })
    .int()
    .positive()
    .optional()
    .nullable(),
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
