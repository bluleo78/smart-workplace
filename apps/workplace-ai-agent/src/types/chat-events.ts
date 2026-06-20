// 6c: workplace-api 가 발사하는 chat.message.posted 이벤트 envelope 의 zod 스키마.
import { z } from 'zod';

const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().nullable().optional(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

export const chatMessagePostedPayload = z.object({
  projectKey: z.string(),
  issueKey: z.string(),
  issueId: z.number(),
  // #368: AI 가 이슈 컨텍스트(제목·상태·본문)를 인지하도록 백엔드가 동봉. AGENT 는 비멤버라
  // get_issue_detail 로 직접 못 읽으므로 여기서 받아 user message 에 주입한다. 구버전 이벤트 호환 위해 optional.
  issueTitle: z.string().optional(),
  issueStatus: z.string().optional(),
  issueBody: z.string().nullable().optional(),
  threadId: z.number(),
  messageId: z.number(),
  actor: userSummary,
  body: z.string(),
  mentions: z.array(userSummary),
  occurredAt: z.string(),
});

export const chatEventEnvelope = z.object({
  type: z.literal('chat.message.posted'),
  payload: chatMessagePostedPayload,
});

export type ChatMessagePostedPayload = z.infer<typeof chatMessagePostedPayload>;
export type ChatEventEnvelope = z.infer<typeof chatEventEnvelope>;

export const CHAT_MESSAGE_POSTED = 'chat.message.posted';
