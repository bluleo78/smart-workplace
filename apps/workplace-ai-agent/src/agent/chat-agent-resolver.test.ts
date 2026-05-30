import { describe, it, expect } from 'vitest';

import { pickMentionedAgentId } from './chat-agent-resolver.js';
import type { ChatMessagePostedPayload } from '../types/chat-events.js';

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
});
