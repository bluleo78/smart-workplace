// src/schemas.ts — 이슈 도구 입력 zod 스키마. 두 앱 공유(기존 중복 제거).
import { z } from 'zod';

/** issueKey 만 받는 최소 입력. */
export const issueKeyInput = z.object({ issueKey: z.string().min(1) });

/** get_issue_detail 입력 — issueKey 에 코멘트 전체 읽기(allComments)를 더했다(WP-353: 기본은 최근 30건, allComments 는 최근 200건까지). */
export const getIssueDetailInput = issueKeyInput.extend({
  allComments: z.boolean().optional(),
});

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
  parent: z.string().min(1).describe('Parent issue key (e.g. WP-12), same project').optional(), // 부모 이슈 키(WP-12, SUBTASK) — 같은 프로젝트의 이슈여야 한다. 핸들러가 서버용 번호로 옮긴다(#833, WP-353)
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
  parent: z.string().min(1).nullable().describe('Parent issue key, same project; null clears').optional(), // 이슈 키(WP-12)=설정, null=해제, 생략=변경없음. 같은 프로젝트만(WP-353)
  assignees: z.array(z.string()).optional(), // username[] → 집합 교체
  labels: z.array(z.string()).optional(), // 라벨명[] → 집합 교체
  milestone: z.string().min(1).nullable().describe('null clears').optional(), // 마일스톤 이름 → milestoneId, null=해제(#854)
  cycles: z.array(z.string()).optional(), // 사이클명[] → 집합 교체, []=전부 해제(#854)
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

/**
 * 이슈 목록 필터 shape — list_issues(데이터 조회, 두 앱 공유)와 ai-agent 의 show_issue_list(화면 표시 지시)가 같은 필터 집합을 쓴다(#371).
 * #403: priority 는 영어 대문자 열거값만 — 한국어("높음") 입력 차단.
 * #841: label·type 은 이름, assignee·reporter 는 username 으로 받는다(서버가 해석). 모르는 값은 서버가 400 + 사용 가능 목록을
 * 돌려주므로 LLM 이 그 목록으로 자가교정할 수 있다.
 */
/** assignee 설명 — 공유 필터와 list_issues 확장(any)이 같은 문구를 쓰도록 한 곳에서 만든다(WP-176). */
const assigneeDescription = (extra: string) =>
  `CSV: "me", "null" (unassigned), usernames${extra}. Defaults to "me" when assignee and reporter are both omitted`;

export const issueListFilterShape = {
  projectKey: z.string().optional().describe('Omit for all my projects'),
  status: z.string().optional().describe('CSV of TODO,IN_PROGRESS,DONE,CANCELED'),
  priority: z.array(z.enum(['LOW', 'MID', 'HIGH'])).optional(),
  label: z.string().optional().describe('CSV of label names; issue must have all (AND)'),
  type: z.string().optional().describe('CSV of type names; any match (OR)'),
  dueFrom: z.string().optional().describe('Due date range, yyyy-MM-dd'),
  dueTo: z.string().optional(),
  // WP-307: 종료일·생성일 범위 — 서버가 Asia/Seoul 하루 경계로 자른다. 값을 그대로 서버에 넘기므로 show_issue_list 도 공유한다.
  closedFrom: z.string().optional().describe('Closed (DONE/CANCELED) date range, yyyy-MM-dd KST, inclusive'),
  closedTo: z.string().optional(),
  createdFrom: z.string().optional().describe('Created date range, yyyy-MM-dd KST, inclusive'),
  createdTo: z.string().optional(),
  q: z.string().optional().describe('Substring of title or body'),
  blocked: z.boolean().optional().describe('true: only issues with an unfinished blocker'),
  topLevel: z.boolean().optional().describe('true: only issues without a parent'),
  assignee: z.string().optional().describe(assigneeDescription('')),
  reporter: z.string().optional().describe('CSV: "me" or usernames'),
  size: z.number().int().min(1).max(100).optional(),
};

/**
 * list_issues 입력 — 필터를 직접 받는 데이터 조회 도구. 공유 필터에 assignee="any"·cycle 을 더한다(WP-176).
 * 두 값은 도구 핸들러가 서버 쿼리로 바꿔 보내므로, params 를 웹이 그대로 서버에 넘기는 show_issue_list 의 shape 에는 넣지 않는다.
 */
export const listIssuesInput = z.object({
  ...issueListFilterShape,
  // WP-352: 이전 호출이 돌려준 nextCursor 를 그대로 넘기면 다음 페이지다. 웹이 params 를 서버에 직접 넘기는 show_issue_list 의 shape 에는 넣지 않는다.
  cursor: z.string().optional().describe('nextCursor (same filters and size)'),
  assignee: z.string().optional().describe(assigneeDescription(', or "any" (any assignee)')),
  cycle: z
    .string()
    .optional()
    .describe(
      'CSV, any match: cycle (사이클) name, "active", "none" (no cycle) or "backlog" (in no active or planned cycle). Names and "active" need projectKey',
    ),
});
