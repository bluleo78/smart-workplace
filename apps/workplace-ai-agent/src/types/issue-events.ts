// 5b-1 이 발사하는 이슈 도메인 이벤트 envelope 의 zod 스키마.
// envelope-only 검증(events.ts) 통과 후 type 별 payload 형태를 재검증한다.
import { z } from 'zod';
import { sharedMemoriesRawField, sharedMoreCountRawField } from '../agent/shared-memory-block.js';

const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

// 모든 이벤트 공통 — issue 식별·actor·assignees·발생 시각.
const common = {
  projectKey: z.string(),
  issueKey: z.string(),
  issueId: z.number(),
  issueTitle: z.string(),
  actor: userSummary,
  assignees: z.array(userSummary),
  occurredAt: z.string(),
  // WP-371: API 가 서버 실행(INTERNAL) 에이전트 중 이벤트 원인에 맞춰 골라 보내는 대행 AI id.
  // 필수 — 없으면(구버전 API·잘못된 이벤트) 스키마 검증에서 400 으로 거절한다(fail-closed, 폴백 없음).
  actingAgentId: z.number().int().positive(),
  // WP-386: 조직 + 그 프로젝트 공용 메모리(대행 AI 가 그 프로젝트를 읽을 수 있을 때만 프로젝트 몫 — API 가 고른다)와 넘친 개수.
  // 구 API 는 생략. 모양은 검사하지 않고(틀려도 실행을 막지 않는다) run-agent 의 withSharedMemory 가 배열 확인·항목 거르기를 한다(이벤트 리터럴 타입을 깨지 않게 transform 없음).
  sharedMemories: sharedMemoriesRawField,
  sharedMemoryMoreCount: sharedMoreCountRawField,
};

export const issueCreatedPayload = z.object({
  ...common,
  status: z.string(),
  priority: z.string(),
});

export const issueAssignedPayload = z.object({
  ...common,
  added: z.array(userSummary),
  removed: z.array(userSummary),
});

export const issueCommentedPayload = z.object({
  ...common,
  commentId: z.number(),
  commentBody: z.string(),
});

// previousStatus·newStatus 는 범주(TODO 등), *StatusName 은 프로젝트가 정한 상태 이름(WP-807).
// 이름은 선택 — 구버전 api 페이로드(이름 없음)도 그대로 통과시킨다.
export const issueStatusChangedPayload = z.object({
  ...common,
  previousStatus: z.string(),
  newStatus: z.string(),
  previousStatusName: z.string().nullish(),
  newStatusName: z.string().nullish(),
});

// WP-989: 반복 AI 작업 회차 실행 — API 스케줄러가 회차 시각마다 반복에 등록된 비서(actingAgentId)에게 보낸다.
// runId 는 결과 보고(POST /internal/issue-recurrence/{issueId}/runs)에 그대로 돌려줘 같은 회차를 두 번 반영하지 않게 한다.
// runAt 은 KST 오프셋이 붙은 ISO, round 는 몇 번째 회차인지(1부터 — 구 API 가 빼도 받는다), issueBody 는 이슈 본문(없으면 null).
export const issueRecurringRunPayload = z.object({
  ...common,
  // 회차의 도구는 반복을 등록한 사람(소유자) 권한으로 돈다 — 홈 AI 채팅과 같은 대행. 없으면 거절(fail-closed: 비서 신원으로 대신 돌리지 않는다).
  ownerUserId: z.number().int().positive(),
  // 대행 호출의 테넌트(X-On-Behalf-Of-Tenant) — 소유자가 여러 워크스페이스에 속해도 이 테넌트로만 읽는다.
  tenantId: z.number().int().positive().nullish(),
  runId: z.string().min(1),
  runAt: z.string(),
  round: z.number().int().positive().optional(),
  recurrence: z.object({ rrule: z.string(), time: z.string() }),
  issueBody: z.string().nullish(),
});

// type 별 분기를 zod 가 알아채도록 discriminatedUnion.
export const issueEventEnvelope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('issue.created'), payload: issueCreatedPayload }),
  z.object({ type: z.literal('issue.assigned'), payload: issueAssignedPayload }),
  z.object({ type: z.literal('issue.commented'), payload: issueCommentedPayload }),
  z.object({
    type: z.literal('issue.status_changed'),
    payload: issueStatusChangedPayload,
  }),
  z.object({ type: z.literal('issue.recurring_run'), payload: issueRecurringRunPayload }),
]);

export type IssueCreatedPayload = z.infer<typeof issueCreatedPayload>;
export type IssueAssignedPayload = z.infer<typeof issueAssignedPayload>;
export type IssueCommentedPayload = z.infer<typeof issueCommentedPayload>;
export type IssueStatusChangedPayload = z.infer<typeof issueStatusChangedPayload>;
export type IssueRecurringRunPayload = z.infer<typeof issueRecurringRunPayload>;
export type IssueEventEnvelope = z.infer<typeof issueEventEnvelope>;

// 본 ai-agent 가 처리하는 알려진 type 들의 prefix — invalid_payload 와
// unsupported_event_type 분기에 사용.
export const KNOWN_TYPE_PREFIX = 'issue.';

// discriminatedUnion 의 type literal 들을 정확히 추출한 Set —
// invalid_payload (알려진 type, 잘못된 payload) 와
// unsupported_event_type (모르는 type) 분기에 사용.
export const KNOWN_ISSUE_TYPES: ReadonlySet<string> = new Set([
  'issue.created',
  'issue.assigned',
  'issue.commented',
  'issue.status_changed',
  'issue.recurring_run',
]);
