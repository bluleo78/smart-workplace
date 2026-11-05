// 5b-1 이 발사하는 이슈 도메인 이벤트 envelope 의 zod 스키마.
// envelope-only 검증(events.ts) 통과 후 type 별 payload 형태를 재검증한다.
import { z } from 'zod';
import { sharedMemoriesRawField, sharedMoreCountRawField } from '../agent/shared-memory-block.js';

const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  // WP-1312: 표시 이름 — 이어 처리 지시문이 「이름(@아이디) 님이 답했습니다」로 쓴다. 구 API 는 싣지 않는다.
  name: z.string().nullish(),
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
  // 회차의 도구를 돌릴 신원 — API 가 AI 종류로 정한다(WP-1314): 개인 비서는 주인, 개인 작업의 공용 비서는 소유자(홈 AI 채팅과 같은 대행),
  // 그 밖의 AI 는 actingAgentId 자신. 없으면 거절(fail-closed: 신원을 여기서 짐작하지 않는다).
  ownerUserId: z.number().int().positive(),
  // 대행 호출의 테넌트(X-On-Behalf-Of-Tenant) — 소유자가 여러 워크스페이스에 속해도 이 테넌트로만 읽는다.
  tenantId: z.number().int().positive().nullish(),
  runId: z.string().min(1),
  runAt: z.string(),
  round: z.number().int().positive().optional(),
  recurrence: z.object({ rrule: z.string(), time: z.string() }),
  issueBody: z.string().nullish(),
  // WP-1375: 이슈챗에서 사람이 남긴 최근 글(오래된 순)과 담당 AI 가 남긴 마지막 글. API 가 둘 다 비면 키를 빼고, 구 API 도 안 보낸다(optional).
  // 시각은 UTC ISO(Z) — 지시문에서 KST 로 바꾼다. 상한은 API 와 같은 값을 agent 도 지킨다(user-message.ts, 방어).
  // owner: 반복을 맡긴 사람 글인지(회차는 이 글의 결정만 따른다), isNew: 지난 회차 이후 글인지. 구 API 는 안 보내 optional — 없으면 참고·새 글 아님.
  recentChat: z
    .object({
      humanMessages: z.array(
        z.object({
          authorName: z.string(),
          body: z.string(),
          createdAt: z.string(),
          owner: z.boolean().optional(),
          isNew: z.boolean().optional(),
        }),
      ),
      lastResult: z.object({ body: z.string(), createdAt: z.string() }).optional(),
    })
    .optional(),
  // WP-1312: 회차가 남긴 질문에 반복을 저장한 사람이 이슈 챗에서 답해 API 가 보낸 이어 처리면 그 질문·답(정기 회차·구 API 는 없음). 답한
  // 사람은 actor(저장한 사람)다 — 그 사람만 답할 수 있다. 이어 처리도 같은 실행(같은 AI 자격·정기 회차와 같은 도구 신원 ownerUserId·recurring
  // 프로필)이고, 지시문만
  // 「질문 X 에 Y 라고 답했다, 이어서 하라」로 바뀐다. runId 는 이어 처리 id("<issueId>-f<답 글 id>")라 같은 보고 경로로 돌려주면
  // API 가 이어 처리 결과로 받는다. 이어 처리에는 round 가 없다.
  followUp: z
    .object({
      question: z.string(),
      answer: z.string(),
      // WP-1313: 테스트 질문(「지금 실행」이 되돌릴 수 없는 쓰기를 멈추고 남긴 질문)의 답이면 그 질문이 멈춘 쓰기 — 이어 처리는 이 도구만
      // (하나당 한 번) 실제로 실행할 수 있고, 다른 되돌릴 수 없는 쓰기는 또 멈춘다. 정기 회차 질문은 없다.
      permittedActions: z
        .array(z.object({ tool: z.string().min(1), args: z.record(z.string(), z.unknown()).nullish() }))
        .nullish(),
    })
    .nullish(),
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
  // WP-1313: 「지금 실행」(테스트 실행)과 그 질문의 이어 처리 — 정기 회차와 같은 페이로드지만 되돌릴 수 없는 쓰기를 멈추는 recurring-test
  // 프로필로 돈다. 따로의 종류로 받아, 이 종류를 모르는 구버전은 거절한다(정기 회차처럼 메일을 바로 보내지 않게 — fail-closed).
  z.object({ type: z.literal('issue.recurring_test_run'), payload: issueRecurringRunPayload }),
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
  'issue.recurring_test_run',
]);
