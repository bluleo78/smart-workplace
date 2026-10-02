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
  milestone: z.string().min(1).nullable().optional(), // 마일스톤 이름 → milestoneId, null=해제(#854)
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
export const issueListFilterShape = {
  projectKey: z.string().optional().describe('특정 프로젝트로 한정(예: "WP"). 생략 시 내가 속한 모든 프로젝트'),
  status: z.string().optional().describe('상태 CSV: TODO,IN_PROGRESS,DONE,CANCELED'),
  priority: z.array(z.enum(['LOW', 'MID', 'HIGH'])).optional(),
  label: z.string().optional().describe('라벨 이름 CSV(예: "버그,문서"). 여러 개면 모두 붙은 이슈만(AND). 대소문자 무시'),
  type: z.string().optional().describe('유형 이름 CSV(예: "BUG,STORY"). 하나라도 일치하면 매칭(OR)'),
  dueFrom: z.string().optional().describe('마감일 하한 yyyy-MM-dd(생성일 아님 — 생성일 필터는 미지원)'),
  dueTo: z.string().optional().describe('마감일 상한 yyyy-MM-dd(생성일 아님 — 생성일 필터는 미지원)'),
  q: z.string().optional(),
  blocked: z.boolean().optional(),
  topLevel: z.boolean().optional(),
  assignee: z
    .string()
    .optional()
    .describe('담당자 CSV: "me"(나) | "null"(담당 없음) | username. 표시 이름이 아닌 username. assignee·reporter 모두 생략 시 "me"'),
  reporter: z.string().optional().describe('작성자 CSV: "me" | username'),
  size: z.number().int().min(1).max(100).optional(),
};

/**
 * list_issues 입력 — 필터를 직접 받는 데이터 조회 도구. 공유 필터에 assignee="any"·cycle 을 더한다(WP-176).
 * 두 값은 도구 핸들러가 서버 쿼리로 바꿔 보내므로, params 를 웹이 그대로 서버에 넘기는 show_issue_list 의 shape 에는 넣지 않는다.
 */
export const listIssuesInput = z.object({
  ...issueListFilterShape,
  assignee: z
    .string()
    .optional()
    .describe(
      '담당자 CSV: "me"(나) | "null"(담당 없음) | username | "any"(담당자 무관 — 프로젝트 전체 이슈). 표시 이름이 아닌 username. assignee·reporter 모두 생략 시 "me"',
    ),
  cycle: z
    .string()
    .optional()
    .describe(
      '사이클 CSV(하나라도 일치하면 매칭, OR): 사이클 이름 | "active"(진행 중 사이클) | "none"(사이클이 하나도 할당되지 않은 이슈) | ' +
        '"backlog"(진행 중·예정 사이클 밖 — 완료 사이클에만 남은 이슈 포함). "사이클 미할당"은 none, "백로그"는 backlog. 이름·active 는 projectKey 필요',
    ),
});
