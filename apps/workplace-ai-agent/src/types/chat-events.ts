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
