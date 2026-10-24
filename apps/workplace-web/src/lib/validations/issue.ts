// 이슈/댓글 폼 검증 스키마 — 백엔드 IssueRequest 제약과 일치.

import { z } from 'zod';

import { isSupportedDateKey, SUPPORTED_DATE_RANGE_MESSAGE } from '../supportedDate';

const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']);
const priorityEnum = z.enum(['LOW', 'MID', 'HIGH']);

// 날짜 칸(HTML date input) 값 — 빈 문자열(미지정) 또는 받는 범위(1900~9999)의 YYYY-MM-DD.
// 칸은 5자리 연도(20260-10-23)도 내보낸다 — 형식만 보던 regex 는 영어 원시 문구를 내거나(시작일) 오류를 그리지 않아
// 「생성」이 아무 반응도 없었다(WP-900). 서버와 같은 한국어 범위 문구로 알린다.
const optionalDateKey = z
  .string()
  .refine((v) => v === '' || isSupportedDateKey(v), SUPPORTED_DATE_RANGE_MESSAGE)
  .optional();

/** 이슈 번호 상한 — 서버 이슈 number(Int) 최댓값. */
const MAX_ISSUE_NUMBER = 2147483647;

export const createIssueSchema = z
  .object({
    // 공백만 있는 제목을 서버 왕복 없이 클라이언트에서 즉시 막기 위해 trim 후 검증 (#612).
    title: z.string().trim().min(1, '제목은 필수입니다').max(200, '제목은 200자 이하여야 합니다'),
    body: z.string().max(10000, '본문은 10000자 이하여야 합니다').optional(),
    priority: priorityEnum.optional(),
    // YYYY-MM-DD 형식 (HTML date input) 또는 빈 문자열 허용
    dueDate: optionalDateKey,
    // 타임라인 간트 뷰 시작일 (#620). dueDate 와 동일 형식/허용값.
    startDate: optionalDateKey,
    // Phase 3c — 생성 시 다중 담당자 지정용. 현재 dialog 에서는 미노출이지만 schema 는 허용.
    assigneeIds: z.array(z.number().int().positive()).optional().nullable(),
    // 이슈 유형 id — 생략 시 백엔드가 TASK 로 fallback.
    typeId: z.number().int().positive().optional().nullable(),
    // SUBTASK 일 때만 의미가 있는 부모 number (Phase 4a).
    // SUBTASK 가 아닌 유형에 동봉하면 백엔드 400 — 다이얼로그에서 송신 시점에 제거.
    // error: valueAsNumber 빈 값 → NaN 변환 시 한국어 오류 표시 (#159). Zod v4 에서는 invalid_type_error 대신 error.
    parentNumber: z
      .number({ error: '부모 이슈 번호를 입력해주세요' })
      // 서버 number 는 int(32비트) — 넘으면 원인 모를 「요청 본문을 해석할 수 없습니다」 400 이라 저장 전에 알린다(WP-906).
      // 아주 큰 수는 안전 정수도 아니라 .int() 에도 걸리므로, 먼저 안내되도록 상한 검사를 앞에 둔다.
      .max(MAX_ISSUE_NUMBER, `부모 이슈 번호는 ${MAX_ISSUE_NUMBER} 이하여야 합니다`)
      // 0·소수·음수는 zod 기본 영문 메시지가 그대로 보이던 것을 한국어로 바꾼다(WP-906).
      .int('부모 이슈 번호는 1 이상의 정수여야 합니다')
      .positive('부모 이슈 번호는 1 이상의 정수여야 합니다')
      .optional()
      .nullable(),
  })
  // 시작일·마감일 둘 다 있을 때만 순서 검증 (#620).
  .refine(
    (v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate,
    { message: '시작일은 마감일보다 늦을 수 없습니다', path: ['startDate'] },
  );
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
