// 6c: workplace-api 가 발사하는 chat.message.posted 이벤트 envelope 의 zod 스키마.
import { z } from 'zod';
import { sharedMemoriesRawField, sharedMoreCountRawField } from '../agent/shared-memory-block.js';

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
  // WP-869: 프로젝트 상태 이름(issueStatus 는 범주). 이름 필드를 보내지 않는 구 API 호환 위해 nullish.
  issueStatusName: z.string().nullish(),
  issueBody: z.string().nullable().optional(),
  threadId: z.number(),
  messageId: z.number(),
  actor: userSummary,
  body: z.string(),
  mentions: z.array(userSummary),
  occurredAt: z.string(),
  // WP-371: API 가 멘션된 서버 실행(INTERNAL) AI 중 골라 보내는 대행 AI id. 필수 — 없으면 400 거절(fail-closed).
  actingAgentId: z.number().int().positive(),
  // WP-386: 조직 + 그 프로젝트 공용 메모리 — 이슈 이벤트와 같은 규칙(모양 검사 없음, 배열 확인·항목 거르기는 withSharedMemory).
  sharedMemories: sharedMemoriesRawField,
  sharedMemoryMoreCount: sharedMoreCountRawField,
});

export const chatEventEnvelope = z.object({
  type: z.literal('chat.message.posted'),
  payload: chatMessagePostedPayload,
});

export type ChatMessagePostedPayload = z.infer<typeof chatMessagePostedPayload>;
export type ChatEventEnvelope = z.infer<typeof chatEventEnvelope>;

export const CHAT_MESSAGE_POSTED = 'chat.message.posted';
