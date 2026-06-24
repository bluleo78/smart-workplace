// 7: workplace-api 가 발사하는 messaging.message.posted 이벤트 envelope 의 zod 스키마.
import { z } from 'zod';

const mentionUser = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().nullable().optional(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

const actor = z.object({
  id: z.number(),
  name: z.string().nullable().optional(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

export const messagingMessagePostedPayload = z.object({
  channelId: z.number(),
  channelKind: z.string(),
  messageId: z.number(),
  respondAsAgentId: z.number(),
  actor,
  body: z.string(),
  mentions: z.array(mentionUser),
  // 트리거 메시지의 parent(스레드 루트). null/미존재면 채널 인라인 멘션.
  triggerParentMessageId: z.number().nullable().optional(),
  occurredAt: z.string(),
});

export const messagingEventEnvelope = z.object({
  type: z.literal('messaging.message.posted'),
  payload: messagingMessagePostedPayload,
});

export type MessagingMessagePostedPayload = z.infer<typeof messagingMessagePostedPayload>;
export type MessagingEventEnvelope = z.infer<typeof messagingEventEnvelope>;

export const MESSAGING_MESSAGE_POSTED = 'messaging.message.posted';
