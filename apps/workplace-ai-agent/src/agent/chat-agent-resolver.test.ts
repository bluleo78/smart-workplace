import { describe, it, expect } from 'vitest';

import { pickMentionedAgentId } from './chat-agent-resolver.js';
import { chatMessagePostedPayload, type ChatMessagePostedPayload } from '../types/chat-events.js';

const payload = (
  mentions: ChatMessagePostedPayload['mentions'],
): ChatMessagePostedPayload => ({
  projectKey: 'WP',
  issueKey: 'WP-1',
  issueId: 1,
  threadId: 5,
  messageId: 9,
  actor: { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
  body: '@AI',
  mentions,
  occurredAt: '2026-05-30T12:00:00Z',
  actingAgentId: 99,
});

describe('pickMentionedAgentId', () => {
  it('API 가 지정한 actingAgentId 를 mentions 순서와 무관하게 그대로 쓴다 (WP-371)', () => {
    const p = payload([
      { id: 98, username: 'ai-a', name: 'A', kind: 'AGENT' },
      { id: 99, username: 'ai-b', name: 'B', kind: 'AGENT' },
    ]);
    expect(pickMentionedAgentId({ ...p, actingAgentId: 99 })).toBe(99);
  });
});

describe('chatMessagePostedPayload.actingAgentId (WP-371, fail-closed)', () => {
  const { actingAgentId: _omit, ...raw } = payload([]);
  it('없으면 거절(폴백 없음)', () => {
    expect(chatMessagePostedPayload.safeParse(raw).success).toBe(false);
  });
  it('양의 정수는 통과, 0·소수는 거절', () => {
    expect(chatMessagePostedPayload.safeParse({ ...raw, actingAgentId: 5 }).success).toBe(true);
    expect(chatMessagePostedPayload.safeParse({ ...raw, actingAgentId: 0 }).success).toBe(false);
    expect(chatMessagePostedPayload.safeParse({ ...raw, actingAgentId: 1.5 }).success).toBe(false);
  });
});
