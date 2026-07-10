// src/schemas.ts — 이슈 도구 입력 zod 스키마. 두 앱 공유(기존 중복 제거).
import { z } from 'zod';

/** issueKey 만 받는 최소 입력. */
export const issueKeyInput = z.object({ issueKey: z.string().min(1) });

/** 이슈 생성 입력 — projectKey 필수(위임 컨텍스트 없이 대상 프로젝트 명시). */
export const createIssueInput = z.object({
  projectKey: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.string().optional(), // 유형 이름(예: BUG) → typeId 리졸브
  assignees: z.array(z.string()).optional(), // username[] → assigneeIds 리졸브
  parent: z.number().int().positive().optional(), // 부모 이슈 번호(SUBTASK)
});

/** 이슈 부분 수정 입력 — 전달 필드만 변경. */
export const updateIssueInput = z.object({
  issueKey: z.string().min(1),
  title: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  clearDueDate: z.boolean().optional(),
  clearStartDate: z.boolean().optional(),
  type: z.string().optional(), // 유형 이름 → typeId
  parent: z.number().int().positive().nullable().optional(), // 번호=설정, null=해제, 생략=변경없음
  assignees: z.array(z.string()).optional(), // username[] → 집합 교체
  labels: z.array(z.string()).optional(), // 라벨명[] → 집합 교체
});

/** 코멘트 작성 입력. */
export const addCommentInput = z.object({ issueKey: z.string().min(1), body: z.string().min(1) });

/** 코멘트 수정 입력. */
export const editCommentInput = z.object({
  issueKey: z.string().min(1),
  commentId: z.number().int().positive(),
  body: z.string().min(1),
});

/** 의존성 add/remove 공용 입력. */
export const dependencyInput = z.object({
  issueKey: z.string().min(1),
  otherIssueKey: z.string().min(1),
  direction: z.enum(['blocks', 'blockedBy']),
});
