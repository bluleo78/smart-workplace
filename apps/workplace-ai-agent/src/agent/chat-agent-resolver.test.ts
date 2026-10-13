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
});

describe('pickMentionedAgentId', () => {
  it('mentions 중 첫 AGENT id', () => {
    expect(
      pickMentionedAgentId(
        payload([
          { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
          { id: 99, username: 'ai', name: 'AI', kind: 'AGENT' },
        ]),
      ),
    ).toBe(99);
  });

  it('AGENT 없으면 null', () => {
    expect(
      pickMentionedAgentId(payload([{ id: 7, username: 'a', name: 'A', kind: 'HUMAN' }])),
    ).toBeNull();
  });

  it('actingAgentId 가 있으면 mentions 순서와 무관하게 그 id (WP-371)', () => {
    const p = payload([
      { id: 98, username: 'ai-a', name: 'A', kind: 'AGENT' },
      { id: 99, username: 'ai-b', name: 'B', kind: 'AGENT' },
    ]);
    expect(pickMentionedAgentId({ ...p, actingAgentId: 99 })).toBe(99);
  });
});

describe('chatMessagePostedPayload.actingAgentId (WP-371)', () => {
  const raw = { ...payload([]) };
  it('없어도 통과(구버전 API 호환)', () => {
    expect(chatMessagePostedPayload.safeParse(raw).success).toBe(true);
  });
  it('양의 정수는 통과, 0·소수는 거절', () => {
    expect(chatMessagePostedPayload.safeParse({ ...raw, actingAgentId: 5 }).success).toBe(true);
    expect(chatMessagePostedPayload.safeParse({ ...raw, actingAgentId: 0 }).success).toBe(false);
    expect(chatMessagePostedPayload.safeParse({ ...raw, actingAgentId: 1.5 }).success).toBe(false);
  });
});
