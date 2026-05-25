// 5b-1 이 발사하는 이슈 도메인 이벤트 envelope 의 zod 스키마.
// envelope-only 검증(events.ts) 통과 후 type 별 payload 형태를 재검증한다.
import { z } from 'zod';

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

export const issueStatusChangedPayload = z.object({
  ...common,
  previousStatus: z.string(),
  newStatus: z.string(),
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
]);

export type IssueCreatedPayload = z.infer<typeof issueCreatedPayload>;
export type IssueAssignedPayload = z.infer<typeof issueAssignedPayload>;
export type IssueCommentedPayload = z.infer<typeof issueCommentedPayload>;
export type IssueStatusChangedPayload = z.infer<typeof issueStatusChangedPayload>;
export type IssueEventEnvelope = z.infer<typeof issueEventEnvelope>;

// 본 ai-agent 가 처리하는 알려진 type 들의 prefix — invalid_payload 와
// unsupported_event_type 분기에 사용.
export const KNOWN_TYPE_PREFIX = 'issue.';
